"""Observe the Floci resources without sending outage alerts through Floci itself."""
import json
import logging
import sqlite3
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from uuid import uuid4

from bridge import WORKFLOW, client


def sample(sqs, db):
    for name in ("cloudsentinels-alerts", "cloudsentinels-failed"):
        try:
            url = sqs.get_queue_url(QueueName=name)["QueueUrl"]
            attrs = sqs.get_queue_attributes(QueueUrl=url, AttributeNames=["ApproximateNumberOfMessages"])
            depth = int(attrs["Attributes"]["ApproximateNumberOfMessages"])
            state = "backlogged" if name == "cloudsentinels-failed" and depth else "healthy"
            yield name, state, f"{depth} messages available"
        except Exception as error:
            yield name, "unavailable", type(error).__name__
    try:
        state = db.describe_table(TableName="runbooks")["Table"]["TableStatus"]
        yield "runbooks", "healthy" if state == "ACTIVE" else "unavailable", state
    except Exception as error:
        yield "runbooks", "unavailable", type(error).__name__


def observe(store, name, state, detail):
    with store:
        previous = store.execute("SELECT state FROM resources WHERE name=?", (name,)).fetchone()
        if previous == (state,):
            return
        store.execute("INSERT OR REPLACE INTO resources VALUES (?,?)", (name, state))
        if previous is None and state == "healthy":
            return
        event = {"eventId": str(uuid4()), "eventType": "floci." + ("recovery" if state == "healthy" else state),
                 "occurredAt": datetime.now(timezone.utc).isoformat(), "resourceName": name,
                 "resourceState": state, "sourceType": "floci.monitor",
                 "severity": "info" if state == "healthy" else "high", "title": f"{name} is {state}",
                 "summary": detail}
        store.execute("INSERT INTO notifications(event) VALUES (?)", (json.dumps(event),))


def deliver(store):
    for seq, raw in store.execute("SELECT seq,event FROM notifications WHERE runbook IS NULL ORDER BY seq LIMIT 20").fetchall():
        request = Request(WORKFLOW, data=raw.encode(), headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=20) as response:
            plan = json.load(response)["sharedRemediationProcedure"]
        if plan.get("incidentId") != json.loads(raw)["eventId"]:
            raise ValueError("Unexpected event ID from n8n")
        with store:
            store.execute("UPDATE notifications SET runbook=? WHERE seq=?", (json.dumps(plan), seq))
        print(json.dumps({"event": json.loads(raw), "notification": plan}), flush=True)


def open_store(path):
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE IF NOT EXISTS resources(name TEXT PRIMARY KEY,state TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS notifications(seq INTEGER PRIMARY KEY,event TEXT NOT NULL,runbook TEXT);
    """)
    return db


def run():
    store = open_store("/var/lib/cloudsentinels/watch.sqlite")
    sqs, db = client("sqs"), client("dynamodb")
    while True:
        for name, state, detail in sample(sqs, db):
            observe(store, name, state, detail)
        try:
            deliver(store)
        except Exception as error:
            logging.warning("n8n notification pending: %s", type(error).__name__)
        time.sleep(30)


if __name__ == "__main__":
    run()
