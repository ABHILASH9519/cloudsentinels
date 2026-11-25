"""Local operator entry point, usable from PowerShell or a Unix terminal."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env.floci"
CLUSTERS = {
    "docker-desktop": ("docker-desktop-kubernetes", "DESKTOP_KEY"),
    "cloudsentinels-local": ("cloudsentinels-local", "MINIKUBE_KEY"),
}


def init():
    try:
        fd = os.open(ENV, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return
    with os.fdopen(fd, "w") as output:
        for key in ("OPERATOR_KEY", "SIGNING_KEY", "DESKTOP_KEY", "MINIKUBE_KEY"):
            print(f"{key}={secrets.token_hex(32)}", file=output)


def compose(*args, **kwargs):
    return subprocess.run(["docker", "compose", "--env-file", str(ENV), *args], cwd=ROOT, check=True, **kwargs)


def agent(context, env):
    cluster, key = CLUSTERS[context]
    subprocess.run(["kubectl", "--context", context, "get", "nodes"], check=True)
    settings = {**os.environ, "CLOUDSENTINELS_AGENT_CONTEXT": context,
                "CLOUDSENTINELS_AGENT_KUBECTL_CONTEXT": context,
                "CLOUDSENTINELS_AGENT_CLUSTER_ID": cluster, "CLOUDSENTINELS_AGENT_TOKEN": env[key],
                "CLOUDSENTINELS_AGENT_ENVIRONMENT": "local",
                "CLOUDSENTINELS_API_URL": "http://127.0.0.1:8082",
                "CLOUDSENTINELS_LAMBDA_TELEMETRY_URL": "", "CLOUDSENTINELS_LAMBDA_SIGNING_SECRET": "",
                "CLOUDSENTINELS_AGENT_ALLOW_MUTATIONS": "false"}
    subprocess.run(["go", "run", "./cmd/cloudsentinels-agent"], cwd=ROOT, env=settings, check=True)


def smoke(env):
    # A synthetic event with a unique identifier never replaces a cluster's latest telemetry.
    event_id = "smoke-" + secrets.token_hex(8)
    body = json.dumps({"eventId": event_id, "eventType": "cluster.warning",
                      "clusterId": "cloudsentinels-local", "severity": "high",
                      "title": "Local pipeline smoke check"}).encode()
    post = Request("http://127.0.0.1:8082/api/v1/agent/events", data=body, headers={
        "Content-Type": "application/json", "Authorization": "Bearer " + env["MINIKUBE_KEY"]})
    with urlopen(post, timeout=15) as response:
        if response.status != 202:
            raise RuntimeError("API did not accept the signed-in cluster event")
    lookup = """from bridge import client
import json,sys
items=client('dynamodb').query(TableName='runbooks',KeyConditionExpression='eventId = :id',ExpressionAttributeValues={':id':{'S':sys.argv[1]}},ConsistentRead=True)['Items']
print(items[0]['runbook']['S'] if items else 'null')"""
    for _ in range(50):
        result = compose("exec", "-T", "bridge", "python", "-c", lookup, event_id, capture_output=True, text=True)
        plan = json.loads(result.stdout)
        if plan and plan["incidentId"] == event_id and plan["executionStatus"] == "NOT_EXECUTED":
            print(json.dumps(plan, indent=2))
            return
        time.sleep(2)
    raise RuntimeError("No matching remediation runbook arrived")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["init", "up", "down", "agent", "smoke"])
    parser.add_argument("context", nargs="?", choices=CLUSTERS)
    args = parser.parse_args()
    if args.action in ("init", "up"):
        init()
    if args.action == "init":
        return
    env = dict(line.split("=", 1) for line in ENV.read_text().splitlines() if line)
    if args.action == "up":
        compose("up", "-d", "--build")
        for _ in range(90):
            try:
                with urlopen("http://127.0.0.1:8082/readyz", timeout=2) as response:
                    if json.load(response)["status"] == "ready":
                        break
            except OSError:
                pass
            time.sleep(2)
        else:
            raise RuntimeError("Go API readiness timed out; inspect docker compose logs")
        print("Dashboard http://127.0.0.1:5173 | n8n http://127.0.0.1:5678")
    elif args.action == "down":
        compose("down")
    elif args.action == "smoke":
        smoke(env)
    elif args.context:
        agent(args.context, env)
    else:
        parser.error("agent requires a kubeconfig context")


if __name__ == "__main__":
    main()
