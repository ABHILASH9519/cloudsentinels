#!/usr/bin/env python3
"""Validate the sanitized Airtable inventory ConfigMap and showcase resources."""
import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "deploy/kubernetes/airtable-inventory-showcase.yaml"
EXPECTED_KINDS = ["Namespace", "ConfigMap", "StorageClass", "PersistentVolumeClaim", "Deployment", "Service"]
SENSITIVE_KEY = re.compile(r"(kubeconfig|token|secret|credential|private.?key|password|api.?key)", re.I)


def reject_sensitive_keys(value, path="$"):
    if isinstance(value, dict):
        for key, child in value.items():
            if SENSITIVE_KEY.search(str(key)):
                raise ValueError(f"Sensitive key in showcase snapshot: {path}.{key}")
            reject_sensitive_keys(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            reject_sensitive_keys(child, f"{path}[{index}]")


def main():
    documents = list(yaml.safe_load_all(MANIFEST.read_text(encoding="utf-8")))
    kinds = [document.get("kind") for document in documents if document]
    if kinds != EXPECTED_KINDS:
        raise SystemExit(f"Unexpected showcase resource sequence: {kinds}")
    config_map = documents[1]
    raw_inventory = config_map.get("data", {}).get("inventory.json")
    if not raw_inventory:
        raise SystemExit("ConfigMap is missing data.inventory.json")
    inventory = json.loads(raw_inventory)
    reject_sensitive_keys(inventory)
    clusters = inventory.get("clusters", {}).get("records", [])
    if len(clusters) != 20 or inventory["clusters"].get("recordCount") != 20:
        raise SystemExit(f"Expected 20 sanitized Airtable cluster rows, found {len(clusters)}")
    names = [record.get("clusterName") for record in clusters]
    if len(set(names)) != len(names) or any(not name for name in names):
        raise SystemExit("Cluster names must be present and unique")
    if inventory.get("source") != "Airtable Cloud-Sentinel":
        raise SystemExit("Unexpected inventory source")
    print("Validated 6 Kubernetes resources and 20 sanitized Airtable cluster rows; no sensitive keys found.")


if __name__ == "__main__":
    main()
