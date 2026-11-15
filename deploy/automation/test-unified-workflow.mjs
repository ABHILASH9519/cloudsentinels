import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.join(dir, 'n8n-cloudsentinels-unified.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
const required = [
  'CloudSentinels Event Webhook',
  'Validate and Normalize Event',
  'AWS EventBridge / SQS Connector',
  'AWS Lambda / Serverless Connector',
  'Docker Desktop Kubernetes Connector',
  'Local Minikube Kubernetes Connector',
  'Unified Remediation Policy',
  'Build Shared Remediation Runbook',
];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
for (const name of required) assert(byName.has(name), `Missing workflow node: ${name}`);
const edge = (from, to) => assert(workflow.connections[from]?.main?.some((output) => output.some((link) => link.node === to)), `Missing edge: ${from} -> ${to}`);
edge('CloudSentinels Event Webhook', 'Validate and Normalize Event');
edge('Validate and Normalize Event', 'AWS EventBridge / SQS Connector');
edge('AWS EventBridge / SQS Connector', 'AWS Lambda / Serverless Connector');
edge('AWS Lambda / Serverless Connector', 'Docker Desktop Kubernetes Connector');
edge('Docker Desktop Kubernetes Connector', 'Local Minikube Kubernetes Connector');
edge('Local Minikube Kubernetes Connector', 'Unified Remediation Policy');
edge('Unified Remediation Policy', 'Critical Event?');
for (const name of required.filter((value) => value.endsWith('Connector'))) {
  const node = byName.get(name);
  assert(node.type === 'n8n-nodes-base.code', `${name} is not a runnable n8n Code node`);
  assert(typeof node.parameters.jsCode === 'string' && node.parameters.jsCode.trim(), `${name} has no code`);
  new Function('$input', node.parameters.jsCode);
}
const fixtures = [
  ['AWS EventBridge / SQS Connector', { eventId: 'test-ec2', eventType: 'EC2 state change', sourceType: 'aws.ec2', resourceId: 'i-test', region: 'eu-north-1' }, 'aws-eventbridge-sqs'],
  ['AWS Lambda / Serverless Connector', { eventId: 'test-lambda', eventType: 'CloudWatch Alarm', service: 'AWS/Lambda', sourceType: 'aws.cloudwatch', functionName: 'operations-api', region: 'ap-south-1' }, 'aws-lambda-cloudwatch-eventbridge'],
  ['Docker Desktop Kubernetes Connector', { eventId: 'test-docker', eventType: 'KubernetesWarning', clusterId: 'docker-desktop-kubernetes', clusterName: 'docker-desktop', sourceType: 'kubernetes.docker-desktop' }, 'docker-desktop-kubernetes-agent'],
  ['Local Minikube Kubernetes Connector', { eventId: 'test-minikube', eventType: 'KubernetesWarning', clusterId: 'cloudsentinels-local', clusterName: 'cloudsentinels-local', sourceType: 'kubernetes.minikube' }, 'minikube-kubernetes-agent'],
];
for (const [nodeName, event, expected] of fixtures) {
  const result = new Function('$input', byName.get(nodeName).parameters.jsCode)({ all: () => [{ json: event }] });
  assert(result.length === 1, `${nodeName} did not return one event`);
  assert(result[0].json.ingestConnector === expected, `${nodeName} classified event as ${result[0].json.ingestConnector}`);
  assert(result[0].json.mutationEnabled !== true, `${nodeName} unexpectedly enabled mutations`);
  console.log(`PASS ${nodeName}: ${expected}`);
}
console.log(`PASS workflow graph: ${workflow.nodes.length} nodes, ${fixtures.length} source adapters`);
