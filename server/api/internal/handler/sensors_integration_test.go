package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSensorsClientCreatesSubscription(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if got := r.Header.Get("api-key"); got != "key-value" {
			t.Fatalf("api-key = %q", got)
		}
		if got := r.Header.Get("sensorsdata-project"); got != "RbowDrama" {
			t.Fatalf("project header = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case sensorsDataSubscriptionPath + "/application/get":
			_, _ = w.Write([]byte(`{"code":"SUCCESS","data":{"application":{"application_id":"shared.app"}}}`))
		case sensorsDataSubscriptionPath + "/create":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(body)
			if !strings.Contains(string(raw), `"event_name":"*"`) {
				t.Fatalf("subscription does not select all events: %s", raw)
			}
			_, _ = w.Write([]byte(`{"code":"SUCCESS","data":{"subscription_id":8006,"project_id":29}}`))
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	client := newSensorsClient(server.URL, "RbowDrama", "key-value", server.Client())
	app, err := client.applicationID(context.Background(), "aerolog-sensors-v1")
	if err != nil || app != "shared.app" {
		t.Fatalf("applicationID = %q, %v", app, err)
	}
	projectID, subscriptionID, err := client.createAllEventsSubscription(context.Background(), app, "aerolog-project-2")
	if err != nil || projectID != "29" || subscriptionID != 8006 {
		t.Fatalf("subscription = %q, %d, %v", projectID, subscriptionID, err)
	}
	if requests != 2 {
		t.Fatalf("requests = %d", requests)
	}
}

func TestEncryptIntegrationSecret(t *testing.T) {
	ciphertext, err := encryptIntegrationSecret("master-key", "api-key-value")
	if err != nil || ciphertext == "" || strings.Contains(ciphertext, "api-key-value") {
		t.Fatalf("ciphertext unsafe: %q, %v", ciphertext, err)
	}
	plaintext, err := decryptIntegrationSecret("master-key", ciphertext)
	if err != nil || plaintext != "api-key-value" {
		t.Fatalf("plaintext = %q, %v", plaintext, err)
	}
}
