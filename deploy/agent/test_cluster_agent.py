import json
import tempfile
import unittest
from pathlib import Path

from cluster_agent import classify_event, init_spool, map_event, queue_event, sign_request


class ClusterAgentTests(unittest.TestCase):
    def test_maps_crash_loop_warning(self):
        event = {
            "type": "Warning",
            "reason": "BackOff",
            "message": "Back-off restarting failed container",
            "metadata": {"uid": "uid-1"},
            "involvedObject": {"kind": "Pod", "name": "checkout", "namespace": "prod"},
            "eventTime": "2026-11-11T10:00:00Z",
        }
        payload = map_event(event)
        self.assertEqual(payload["eventType"], "PodCrashLoopBackOff")
        self.assertEqual(payload["severity"], "high")
        self.assertEqual(payload["resourceName"], "checkout")
        self.assertEqual(len(payload["eventId"]), 64)

    def test_ignores_normal_and_unmapped_events(self):
        self.assertIsNone(map_event({"type": "Normal", "reason": "Started"}))
        self.assertIsNone(map_event({"type": "Warning", "reason": "Unmapped"}))

    def test_image_pull_backoff_is_not_misclassified_as_crash_loop(self):
        result = classify_event({
            "reason": "BackOff",
            "message": "Back-off pulling image",
        })
        self.assertEqual(result, ("DeploymentUnhealthy", "medium"))

    def test_spool_deduplicates_pending_and_acknowledged_events(self):
        with tempfile.TemporaryDirectory() as directory:
            db = init_spool(str(Path(directory) / "agent.sqlite3"))
            payload = {"eventId": "evt-1", "eventType": "NodeNotReady"}
            self.assertTrue(queue_event(db, payload))
            self.assertFalse(queue_event(db, payload))
            db.execute(
                "INSERT INTO acknowledged_events(event_id, sent_at) VALUES (?, ?)",
                ("evt-2", 1),
            )
            db.commit()
            self.assertFalse(queue_event(db, {"eventId": "evt-2"}))
            db.close()

    def test_hmac_signing_is_deterministic(self):
        raw = b'{"eventId":"evt-1"}'
        first = sign_request("1794400000", "demo-cluster", raw, "a-long-test-secret-value-at-least-32-chars")
        second = sign_request("1794400000", "demo-cluster", raw, "a-long-test-secret-value-at-least-32-chars")
        self.assertEqual(first, second)
        self.assertEqual(len(first), 64)


if __name__ == "__main__":
    unittest.main()
