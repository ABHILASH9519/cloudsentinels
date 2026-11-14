// Explicit adapter for the Docker Desktop built-in Kubernetes cluster.
return $input.all().map(({ json: e }) => {
  const clusterId = String(e.clusterId || "").toLowerCase();
  const clusterName = String(e.clusterName || "").toLowerCase();
  const source = String(e.sourceType || "").toLowerCase();
  const isDockerDesktop = clusterId === "docker-desktop-kubernetes" ||
    clusterName === "docker-desktop" || clusterName === "docker-desktop-kubernetes" ||
    clusterId === "docker-desktop" || source.includes("docker-desktop");
  if (!isDockerDesktop) return { json: e };
  return { json: {
    ...e,
    sourceType: e.sourceType || "kubernetes.docker-desktop",
    environment: e.environment || "local",
    ingestConnector: "docker-desktop-kubernetes-agent",
    kubernetes: { provider: "Docker Desktop", context: "docker-desktop",
      clusterId: "docker-desktop-kubernetes", mode: "local", diagnostics: [
        "nodes", "pods", "warning-events", "deployments", "cpu-memory"
      ], mutationEnabled: false, approvalRequiredForChanges: true }
  }};
});
