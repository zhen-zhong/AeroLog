package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSensorsConsumerSpecs(t *testing.T) {
	h := &DataQualityHandler{
		SensorsEventsTopic:   "sensors.events.v1",
		SensorsEventsGroup:   "aerolog-sensors-consumer",
		SensorsProfilesTopic: "sensors.profiles.v1",
		SensorsProfilesGroup: "aerolog-sensors-profiles-consumer",
	}
	got := h.sensorsConsumerSpecs()
	if len(got) != 2 {
		t.Fatalf("spec count = %d, want 2", len(got))
	}
	if got[0].Name != "事件" || got[0].Topic != "sensors.events.v1" || got[0].GroupID != "aerolog-sensors-consumer" || got[0].Job != "aerolog-sensors-consumer" {
		t.Fatalf("event spec = %#v", got[0])
	}
	if got[1].Name != "用户属性" || got[1].Topic != "sensors.profiles.v1" || got[1].GroupID != "aerolog-sensors-profiles-consumer" || got[1].Job != "aerolog-sensors-profile-consumer" {
		t.Fatalf("profile spec = %#v", got[1])
	}
}

func TestSensorsConsumerSpecsSkipsIncompleteConfig(t *testing.T) {
	h := &DataQualityHandler{SensorsEventsTopic: "sensors.events.v1", SensorsProfilesGroup: "aerolog-sensors-profiles-consumer"}
	if got := h.sensorsConsumerSpecs(); len(got) != 0 {
		t.Fatalf("spec count = %d, want 0", len(got))
	}
}

func TestPromQLStringEscapesValue(t *testing.T) {
	if got, want := promQLString("topic\\\"name"), `"topic\\\"name"`; got != want {
		t.Fatalf("promQLString() = %q, want %q", got, want)
	}
}

func TestSharedQueueHealthReturnsEachSensorsConsumer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		if !strings.Contains(query, "aerolog-sensors-") {
			t.Fatalf("unexpected Prometheus query: %s", query)
		}
		value := "1"
		if strings.Contains(query, "aerolog_consumer_kafka_lag") && strings.Contains(query, "sensors.events.v1") {
			value = "3"
		}
		if strings.Contains(query, "aerolog_consumer_kafka_lag") && strings.Contains(query, "sensors.profiles.v1") {
			value = "5"
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"result":[{"metric":{},"value":[0,"` + value + `"]}]}}`))
	}))
	defer server.Close()

	h := &DataQualityHandler{
		PrometheusURL:      server.URL,
		SensorsApplication: "aerolog-sensors-v1",
		SensorsEventsTopic: "sensors.events.v1", SensorsEventsGroup: "aerolog-sensors-consumer",
		SensorsProfilesTopic: "sensors.profiles.v1", SensorsProfilesGroup: "aerolog-sensors-profiles-consumer",
	}
	got := h.sharedQueueHealth(context.Background())
	if !got.Available || !got.ConsumersUp || got.KafkaLag != 8 || got.ApplicationName != "aerolog-sensors-v1" {
		t.Fatalf("queue health = %#v", got)
	}
	if len(got.Consumers) != 2 || got.Consumers[0].KafkaLag != 3 || got.Consumers[1].KafkaLag != 5 {
		t.Fatalf("consumer health = %#v", got.Consumers)
	}
}
