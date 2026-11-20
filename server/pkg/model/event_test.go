package model

import "testing"

func TestEnvelopedEventTraceRoundTrip(t *testing.T) {
	want := &EnvelopedEvent{
		ProjectID:  7,
		ReceivedAt: 123,
		Event: Event{
			Type:       EventTypeTrack,
			Event:      "test_event",
			DistinctID: "user-1",
			Time:       100,
			Lib:        Lib{Name: "android", Version: "1.2.3"},
		},
		Trace: Trace{
			TraceID:             "insert-1",
			InsertID:            "insert-1",
			SessionID:           "session-1",
			DeviceID:            "device-1",
			CollectorReceivedAt: 123,
			ConsumerReceivedAt:  456,
			KafkaTopic:          "events.raw",
			KafkaPartition:      2,
			KafkaOffset:         99,
		},
	}

	raw, err := want.MarshalKafka()
	if err != nil {
		t.Fatal(err)
	}
	got, err := UnmarshalKafka(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.Trace != want.Trace {
		t.Fatalf("trace = %#v, want %#v", got.Trace, want.Trace)
	}
}
