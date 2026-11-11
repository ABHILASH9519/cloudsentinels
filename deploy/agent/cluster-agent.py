#!/usr/bin/env python3
"""Read-only Kubernetes Warning-event collector for CloudSentinels.

The agent polls Kubernetes Events, stores an on-disk retry queue, and sends
HMAC-signed telemetry to the CloudSentinels API. It never changes cluster state.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REASON_MAP = {
    "NodeNotReady": ("NodeNotReady", "critical"),
    "MemoryPressure": ("MemoryPressure", "high"),
    "OOMKilling": ("MemoryPressure", "high"),
    "Evicted": ("MemoryPressure", "high"),
    "Unhealthy": ("DeploymentUnhealthy", "medium"),
    "FailedScheduling": ("DeploymentUnhealthy", "medium"),
    "FailedCreate": ("DeploymentUnhealthy", "medium"),
    "ProgressDeadlineExceeded": ("DeploymentUnhealthy", "medium"),
}


def classify_event(event: dict) -> tuple[str, str] | None:
    reason = str(event.get("reason") or "")
    message = str(event.get("message") or "")
    if reason in ("BackOff", "CrashLoopBackOff"):
        lowered = message.lower()
        if "pull" in lowered and "image" in lowered:
            return "DeploymentUnhealthy", "medium"
        return "PodCrashLoopBackOff", "high"
    return REASON_MAP.get(reason)


def map_event(event: dict) -> dict | None:
    if event.get("type") != "Warning":
        return None
    classification = classify_event(event)
    if not classification:
        return None

    event_type, severity = classification
    metadata = event.get("metadata") or {}
    involved = event.get("involvedObject") or {}
    reason = str(event.get("reason") or event_type)
    name = str(involved.get("name") or "unknown")
    kind = str(involved.get("kind") or "Resource")
    namespace = str(involved.get("namespace") or "")
    observed_at = (
        event.get("eventTime")
        or event.get("lastTimestamp")
        or metadata.get("creationTimestamp")
        or ""
    )
    fingerprint = "|".join(
        [
            str(metadata.get("uid") or ""),
            str(observed_at),
            str(event.get("count") or 1),
            reason,
            str(event.get("message") or ""),
        ]
    )
    event_id = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
    title = f"{reason}: {kind}/{name}"[:200]

    return {
        "eventId": event_id,
        "eventType": event_type,
        "severity": severity,
        "title": title,
        "message": str(event.get("message") or "")[:5000],
        "namespace": namespace[:128],
        "resourceKind": kind[:80],
        "resourceName": name[:256],
        "observedAt": str(observed_at)[:40],
    }


def init_spool(path: str) -> sqlite3.Connection:
    target = Path(path).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(target))
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS pending_events (
          event_id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at INTEGER NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS acknowledged_events (
          event_id TEXT PRIMARY KEY,
          sent_at INTEGER NOT NULL
        )
        """
    )
    connection.commit()
    return connection


def queue_event(connection: sqlite3.Connection, payload: dict) -> bool:
    event_id = payload["eventId"]
    sent = connection.execute(
        "SELECT 1 FROM acknowledged_events WHERE event_id = ?",
        (event_id,),
    ).fetchone()
    if sent:
        return False
    cursor = connection.execute(
        """
        INSERT OR IGNORE INTO pending_events(event_id, payload, created_at)
        VALUES (?, ?, ?)
        """,
        (event_id, json.dumps(payload, separators=(",", ":"), sort_keys=True), int(time.time())),
    )
    connection.commit()
    return cursor.rowcount == 1


def sign_request(timestamp: str, raw_body: bytes, signing_secret: str) -> str:
    message = timestamp.encode("ascii") + b"." + raw_body
    return hmac.new(signing_secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def post_event(api_url: str, cluster_id: str, signing_secret: str, payload: dict) -> dict:
    raw_body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    timestamp = str(int(time.time()))
    signature = sign_request(timestamp, raw_body, signing_secret)
    request = urllib.request.Request(
        api_url.rstrip("/") + "/telemetry/events",
        data=raw_body,
        headers={
            "Content-Type": "application/json",
            "x-cs-cluster-id": cluster_id,
            "x-cs-timestamp": timestamp,
            "x-cs-signature": signature,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        body = response.read().decode("utf-8")
        return json.loads(body) if body else {"accepted": True}


def flush_pending(
    connection: sqlite3.Connection,
    api_url: str,
    cluster_id: str,
    signing_secret: str,
    batch_size: int = 100,
) -> tuple[int, int]:
    rows = connection.execute(
        "SELECT event_id, payload FROM pending_events ORDER BY created_at LIMIT ?",
        (batch_size,),
    ).fetchall()
    sent = 0
    failed = 0
    for event_id, encoded in rows:
        try:
            payload = json.loads(encoded)
            post_event(api_url, cluster_id, signing_secret, payload)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as error:
            connection.execute(
                "UPDATE pending_events SET attempts = attempts + 1, last_error = ? WHERE event_id = ?",
                (str(error)[:500], event_id),
            )
            failed += 1
        else:
            connection.execute(
                "INSERT OR REPLACE INTO acknowledged_events(event_id, sent_at) VALUES (?, ?)",
                (event_id, int(time.time())),
            )
            connection.execute("DELETE FROM pending_events WHERE event_id = ?", (event_id,))
            sent += 1
    connection.execute(
        "DELETE FROM acknowledged_events WHERE sent_at < ?",
        (int(time.time()) - 30 * 24 * 60 * 60,),
    )
    connection.commit()
    return sent, failed


def kubectl_prefix() -> list[str]:
    host = os.getenv("KUBERNETES_SERVICE_HOST")
    if not host:
        return ["kubectl"]
    token_path = Path("/var/run/secrets/kubernetes.io/serviceaccount/token")
    ca_path = Path("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")
    token = token_path.read_text(encoding="utf-8").strip()
    port = os.getenv("KUBERNETES_SERVICE_PORT_HTTPS", "443")
    return [
        "kubectl",
        "--server",
        f"https://{host}:{port}",
        "--token",
        token,
        "--certificate-authority",
        str(ca_path),
    ]


def fetch_warning_events() -> list[dict]:
    command = kubectl_prefix() + [
        "get",
        "events",
        "--all-namespaces",
        "--field-selector",
        "type=Warning",
        "-o",
        "json",
        "--request-timeout=20s",
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=25)
    decoded = json.loads(result.stdout)
    return decoded.get("items", [])


def run_once(connection: sqlite3.Connection, api_url: str, cluster_id: str, secret: str) -> tuple[int, int, int]:
    events = fetch_warning_events()
    queued = sum(1 for event in events if (payload := map_event(event)) and queue_event(connection, payload))
    sent, failed = flush_pending(connection, api_url, cluster_id, secret)
    print(f"observed={len(events)} queued={queued} sent={sent} pending_failures={failed}", flush=True)
    return queued, sent, failed


def main() -> int:
    parser = argparse.ArgumentParser(description="CloudSentinels read-only Kubernetes event collector")
    parser.add_argument("--once", action="store_true", help="Poll once and exit")
    parser.add_argument("--healthcheck", action="store_true", help="Validate local spool and exit")
    parser.add_argument("--poll-interval", type=int, default=int(os.getenv("POLL_INTERVAL_SECONDS", "30")))
    parser.add_argument("--spool", default=os.getenv("SPOOL_DB_PATH", "~/.cloudsentinels-agent/events.sqlite3"))
    args = parser.parse_args()

    connection = init_spool(args.spool)
    if args.healthcheck:
        connection.close()
        return 0

    api_url = os.getenv("CLOUDSENTINELS_API_URL", "").strip()
    cluster_id = os.getenv("CLOUDSENTINELS_CLUSTER_ID", "").strip()
    signing_secret = os.getenv("CLOUDSENTINELS_SIGNING_SECRET", "")
    if not api_url or not cluster_id or len(signing_secret) < 32:
        print("Set CLOUDSENTINELS_API_URL, CLOUDSENTINELS_CLUSTER_ID, and a 32+ character CLOUDSENTINELS_SIGNING_SECRET.", file=sys.stderr)
        return 2

    try:
        while True:
            try:
                run_once(connection, api_url, cluster_id, signing_secret)
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, ValueError) as error:
                print(f"collector_error={type(error).__name__}: {error}", file=sys.stderr, flush=True)
            if args.once:
                break
            time.sleep(max(5, args.poll_interval))
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
