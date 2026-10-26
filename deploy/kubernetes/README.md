# Kubernetes monitoring integration

This directory contains Prometheus Operator alert rules for Kubernetes workload health. It is an integration asset, not a claim that CloudSentinels is already connected to a live cluster.

## Prerequisites

- A Kubernetes cluster with kube-state-metrics and cAdvisor/container metrics scraped by Prometheus.
- Prometheus Operator installed (for example, through kube-prometheus-stack).
- A `monitoring` namespace and a Prometheus rule selector that accepts the label `release: kube-prometheus-stack` (adjust the namespace and label to match your installation).

## Install

```bash
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f deploy/kubernetes/prometheus-rules.yaml
kubectl -n monitoring get prometheusrules cloudsentinels-kubernetes-alerts
```

If your Prometheus Operator only selects rules with specific namespace/labels, update the manifest metadata to match its selectors. Validate rule expressions against the metrics exposed by your installation; metric names and resource-request series vary by Prometheus/kube-state-metrics version.

## Rules included

- Pod stuck in `CrashLoopBackOff`
- Deployment with unavailable replicas
- Container CPU usage above 90% of requested CPU
- Container memory usage above 90% of requested memory

These rules create Prometheus alert states. To show them inside the CloudSentinels UI, a separately authenticated Alertmanager/webhook ingestion service must forward events into the backend. Do not expose the canister or webhook to unauthenticated write access. The current UI's manual alert and metric forms store records; they do not scrape Prometheus by themselves.
