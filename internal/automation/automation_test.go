package automation

import (
	"testing"
	"time"
)

func TestWebhookSignatureRequiresFreshTimestamp(t *testing.T) {
	secret := "test-secret-that-is-long-enough-for-a-hmac"
	body := []byte(`{"eventType":"incident.created"}`)
	stamp := time.Now().UTC().Format(time.RFC3339)
	if err := Verify(secret, stamp, Sign(secret, stamp, body), body, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if err := Verify(secret, stamp, Sign(secret, stamp, body), body, time.Now().Add(6*time.Minute)); err == nil {
		t.Fatal("expected stale webhook to be rejected")
	}
}

func TestQueueBlocksUnapprovedMutation(t *testing.T) {
	q := NewQueue()
	_, err := q.Enqueue(Command{Action: "restart-deployment", ClusterID: "minikube", Namespace: "default", Deployment: "api", ApprovalStatus: "pending"})
	if err == nil {
		t.Fatal("expected unapproved mutation to be rejected")
	}
	_, err = q.Enqueue(Command{Action: "restart-deployment", ClusterID: "minikube", Namespace: "default", Deployment: "api", ApprovalStatus: "approved", ApprovedBy: "reviewer"})
	if err != nil {
		t.Fatal(err)
	}
}

func TestQueueRejectsArbitraryShellActions(t *testing.T) {
	q := NewQueue()
	if _, err := q.Enqueue(Command{Action: "powershell", ClusterID: "minikube"}); err == nil {
		t.Fatal("expected arbitrary command to be rejected")
	}
}

func TestQueueDispatchesReadOnlyCommands(t *testing.T) {
	q := NewQueue()
	_, err := q.Enqueue(Command{Action: "collect-snapshot", ClusterID: "minikube"})
	if err != nil {
		t.Fatal(err)
	}
	items := q.Pending(10)
	if len(items) != 1 || items[0].Status != "dispatched" {
		t.Fatalf("unexpected pending commands: %#v", items)
	}
}
