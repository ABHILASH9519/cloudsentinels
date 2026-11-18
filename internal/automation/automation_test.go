package automation

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestEventIncludesValidatedTargetCategory(t *testing.T) {
	event := Event{
		EventType: "incident.created",
		Target:    "online-serverless",
		Summary:   "A new incident was created. Open CloudSentinels to inspect its details.",
	}
	encoded, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	var decoded Event
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Target != "online-serverless" {
		t.Fatalf("expected target category to round-trip, got %q", decoded.Target)
	}
}

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

func TestQueueRequiresApprovalForRollbackAndDispatchesOnlyAfterApproval(t *testing.T) {
	q := NewQueue()
	base := Command{ID: "rollback-test", Action: "rollback-deployment", ClusterID: "local-cluster", Namespace: "payments", Deployment: "api", ApprovalStatus: "pending"}
	if _, err := q.Enqueue(base); err == nil {
		t.Fatal("rollback must require explicit approval")
	}
	base.ApprovalStatus, base.ApprovedBy = "approved", "operator@example.test"
	if _, err := q.Enqueue(base); err != nil {
		t.Fatal(err)
	}
	items := q.PendingForCluster("local-cluster", 10)
	if len(items) != 1 || items[0].Action != "rollback-deployment" {
		t.Fatalf("approved rollback not dispatched: %#v", items)
	}
}

func TestDispatcherSendIsSafeForConcurrentCallsWithoutConfiguredClient(t *testing.T) {
	var mu sync.Mutex
	seen := make(map[string]bool)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("X-CS-Signature") == "" {
			t.Errorf("unexpected webhook request: method=%s signed=%t", r.Method, r.Header.Get("X-CS-Signature") != "")
		}
		var event Event
		if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
			t.Errorf("decode event: %v", err)
		} else {
			mu.Lock()
			if event.EventID == "" || seen[event.EventID] {
				t.Errorf("event id is empty or duplicated: %q", event.EventID)
			}
			seen[event.EventID] = true
			mu.Unlock()
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	dispatcher := &Dispatcher{URL: server.URL, Secret: "test-secret-that-is-long-enough-for-a-hmac"}
	const requests = 32
	var wg sync.WaitGroup
	errors := make(chan error, requests)
	for i := 0; i < requests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := dispatcher.Send(Event{EventType: "concurrency.test"}); err != nil {
				errors <- err
			}
		}()
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		t.Errorf("concurrent webhook delivery failed: %v", err)
	}
}
