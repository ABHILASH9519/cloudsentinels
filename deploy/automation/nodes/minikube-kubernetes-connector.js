// Explicit adapter for the standalone local Minikube Kubernetes cluster.
return $input.all().map(({ json: e }) => {
  const clusterId = String(e.clusterId || "").toLowerCase();
  const clusterName = String(e.clusterName || "").toLowerCase();
  const source = String(e.sourceType || "").toLowerCase();
  const isMinikube = clusterId === "cloudsentinels-local" ||
    clusterName === "cloudsentinels-local" || clusterName === "minikube" ||
    source.includes("minikube");
  if (!isMinikube) return { json: e };
  return { json: {
    ...e,
    sourceType: e.sourceType || "kubernetes.minikube",
    environment: e.environment || "local",
    ingestConnector: "minikube-kubernetes-agent",
    kubernetes: { provider: "Minikube", context: "cloudsentinels-local",
      clusterId: "cloudsentinels-local", mode: "local", diagnostics: [
        "nodes", "pods", "warning-events", "deployments", "cpu-memory"
      ], mutationEnabled: false, approvalRequiredForChanges: true }
  }};
});
