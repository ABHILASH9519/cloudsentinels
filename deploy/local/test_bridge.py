import hashlib
import hmac
import json
import unittest
from datetime import datetime, timezone
from io import BytesIO
from unittest.mock import Mock, patch

from bridge import process, signed


class BridgeTest(unittest.TestCase):
    def test_authenticates_original_bytes(self):
        stamp = datetime.now(timezone.utc).isoformat()
        digest = hmac.new(b"key", stamp.encode() + b".{}", hashlib.sha256).hexdigest()
        self.assertTrue(signed(b"key", stamp, digest, b"{}"))
        self.assertFalse(signed(b"key", stamp, digest, b"[]"))
        self.assertFalse(signed(b"key", "", digest, b"{}"))

    def test_ack_after_runbook(self):
        sqs, db = Mock(), Mock()
        db.get_item.return_value = {}
        message = {"Body": '{"eventId":"e1"}', "ReceiptHandle": "r1"}
        plan = {"incidentId": "e1", "executionStatus": "NOT_EXECUTED"}
        with patch("bridge.urlopen", return_value=BytesIO(json.dumps({"sharedRemediationProcedure": plan}).encode())):
            process(sqs, db, "queue", message)
        db.put_item.assert_called_once()
        self.assertIn("delivery", db.put_item.call_args.kwargs["Item"])
        sqs.delete_message.assert_called_once()
        sqs.reset_mock()
        with patch("bridge.urlopen", side_effect=OSError):
            with self.assertRaises(OSError):
                process(sqs, db, "queue", message)
        sqs.delete_message.assert_not_called()
        db.get_item.return_value = {"Item": {"eventId": {"S": "e1"}}}
        with patch("bridge.urlopen") as webhook:
            process(sqs, db, "queue", message)
            webhook.assert_not_called()
