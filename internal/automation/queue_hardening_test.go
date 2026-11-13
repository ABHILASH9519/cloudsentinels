package automation

import (
	"testing"
	"time"
)

func TestQueueRejectsUnsafeCommandIDsAndTargets(t *testing.T) {
	q := NewQueue()
	if _, err := q.Enqueue(Command{ID: "../../evil", Action: "collect-snapshot", ClusterID: "minikube"}); err == nil {
		t.Fatal("unsafe command ID should be rejected")
	}
	if _, err := q.Enqueue(Command{ID: "safe-id", Action: "rollout-status", ClusterID: "minikube", Namespace: "default", Deployment: "bad/name"}); err == nil {
		t.Fatal("unsafe deployment target should be rejected")
	}
}

func TestQueueIdempotencyRejectsReusedIDForDifferentAction(t *testing.T) {
	q := NewQueue()
	_, err := q.Enqueue(Command{ID: "same-id", Action: "collect-snapshot", ClusterID: "minikube"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = q.Enqueue(Command{ID: "same-id", Action: "rollout-status", ClusterID: "minikube", Namespace: "default", Deployment: "api"}); err == nil {
		t.Fatal("same command ID must not be reused for a different action")
	}
}

func TestQueueReleasesExpiredAgentLease(t *testing.T) {
	q := NewQueue()
	cmd, err := q.Enqueue(Command{ID: "lease-test", Action: "collect-snapshot", ClusterID: "minikube"})
	if err != nil {
		t.Fatal(err)
	}
	first := q.PendingForCluster("minikube", 10)
	if len(first) != 1 || first[0].Status != "dispatched" {
		t.Fatalf("expected first dispatch: %#v", first)
	}
	q.mu.Lock()
	expired := q.items[cmd.ID]
	expired.UpdatedAt = time.Now().Add(-3 * time.Minute)
	q.items[cmd.ID] = expired
	q.mu.Unlock()
	second := q.PendingForCluster("minikube", 10)
	if len(second) != 1 || second[0].Status != "dispatched" {
		t.Fatalf("expired command should be redelivered: %#v", second)
	}
}
