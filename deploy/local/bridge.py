"""Signed API events -> local SQS -> n8n -> durable runbook by event ID."""
import hashlib
import hmac
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen

ENDPOINT = "http://floci:4566"
WORKFLOW = "http://n8n:5678/webhook/cloudsentinels/unified-events"


def client(service):
    import boto3
    return boto3.client(service, endpoint_url=ENDPOINT, region_name="us-east-1",
                        aws_access_key_id="test", aws_secret_access_key="test")


def provision(sqs, db):
    dead = sqs.create_queue(QueueName="cloudsentinels-failed")["QueueUrl"]
    arn = sqs.get_queue_attributes(QueueUrl=dead, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]
    queue = sqs.create_queue(QueueName="cloudsentinels-alerts", Attributes={
        "VisibilityTimeout": "90",
        "RedrivePolicy": json.dumps({"deadLetterTargetArn": arn, "maxReceiveCount": "10"})
    })["QueueUrl"]
    try:
        db.create_table(TableName="runbooks", BillingMode="PAY_PER_REQUEST",
                        KeySchema=[{"AttributeName": "eventId", "KeyType": "HASH"},
                                   {"AttributeName": "delivery", "KeyType": "RANGE"}],
                        AttributeDefinitions=[{"AttributeName": key, "AttributeType": "S"}
                                              for key in ("eventId", "delivery")])
    except db.exceptions.ResourceInUseException:
        pass
    db.get_waiter("table_exists").wait(TableName="runbooks", WaiterConfig={"Delay": 1, "MaxAttempts": 30})
    return queue


def signed(secret, stamp, signature, body):
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(stamp)).total_seconds()
    except (TypeError, ValueError):
        return False
    digest = hmac.new(secret, stamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    return abs(age) <= 300 and hmac.compare_digest(digest, signature)


def ingest(sqs, queue, secret):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/ready":
                return self.send_error(404)
            self.send_response(204)
            self.end_headers()

        def do_POST(self):
            if self.path != "/events":
                return self.send_error(404)
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 65536:
                    return self.send_error(413)
                body = self.rfile.read(size)
                if not signed(secret, self.headers.get("X-CS-Timestamp", ""), self.headers.get("X-CS-Signature", ""), body):
                    return self.send_error(401)
                event = json.loads(body)
                if not isinstance(event, dict) or not event.get("eventId") or not event.get("eventType"):
                    return self.send_error(422)
                sqs.send_message(QueueUrl=queue, MessageBody=body.decode())
            except (ValueError, UnicodeError):
                return self.send_error(400)
            except Exception:
                logging.exception("Queue unavailable")
                return self.send_error(503)
            self.send_response(202)
            self.end_headers()
    return Handler


def process(sqs, db, queue, message):
    event = json.loads(message["Body"])
    # Incident updates can share an event ID, including across cluster sources.
    # SQS redelivery preserves the body, including the original occurrence time.
    fingerprint = hashlib.sha256(message["Body"].encode()).hexdigest()
    key = {"eventId": {"S": event["eventId"]}, "delivery": {"S": fingerprint}}
    if "Item" not in db.get_item(TableName="runbooks", Key=key, ConsistentRead=True):
        request = Request(WORKFLOW, data=message["Body"].encode(), headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=45) as response:
            plan = json.load(response)["sharedRemediationProcedure"]
        if plan["incidentId"] != event["eventId"] or plan["executionStatus"] != "NOT_EXECUTED":
            raise ValueError("Unexpected n8n runbook response")
        db.put_item(TableName="runbooks", Item={**key, "runbook": {"S": json.dumps(plan)}})
    sqs.delete_message(QueueUrl=queue, ReceiptHandle=message["ReceiptHandle"])


def run():
    sqs, db = client("sqs"), client("dynamodb")
    queue = provision(sqs, db)
    server = ThreadingHTTPServer(("127.0.0.1", 8091), ingest(sqs, queue, os.environ["N8N_SIGNING_SECRET"].encode()))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    while True:
        try:
            batch = sqs.receive_message(QueueUrl=queue, WaitTimeSeconds=15)
            for message in batch.get("Messages", []):
                process(sqs, db, queue, message)
        except Exception:
            logging.exception("Delivery failed; unacknowledged messages will retry")
            time.sleep(2)


if __name__ == "__main__":
    run()
