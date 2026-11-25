import json
import unittest
from io import BytesIO
from unittest.mock import patch

from watch import deliver, observe, open_store


class WatchTest(unittest.TestCase):
    def test_outage_and_recovery_survive_delivery_failure(self):
        store = open_store(":memory:")
        for state in ("healthy", "unavailable", "unavailable", "healthy"):
            observe(store, "runbooks", state, state)
        rows = store.execute("SELECT event FROM notifications ORDER BY seq").fetchall()
        self.assertEqual([json.loads(row[0])["eventType"] for row in rows],
                         ["floci.unavailable", "floci.recovery"])
        with patch("watch.urlopen", side_effect=OSError), self.assertRaises(OSError):
            deliver(store)
        def respond(request, timeout):
            event = json.loads(request.data)
            return BytesIO(json.dumps({"sharedRemediationProcedure": {"incidentId": event["eventId"]}}).encode())
        with patch("watch.urlopen", side_effect=respond) as post:
            deliver(store)
            deliver(store)
            self.assertEqual(post.call_count, 2)
        self.assertEqual(store.execute("SELECT COUNT(*) FROM notifications WHERE runbook IS NULL").fetchone()[0], 0)
