package worker

import (
	"encoding/json"
	"testing"
	"time"
)

func TestRetryDelayCapsAtMaximum(t *testing.T) {
	initial := time.Second
	maximum := 8 * time.Second
	cases := []struct {
		attempt int
		want    time.Duration
	}{
		{attempt: 0, want: time.Second},
		{attempt: 1, want: 2 * time.Second},
		{attempt: 2, want: 4 * time.Second},
		{attempt: 3, want: 8 * time.Second},
		{attempt: 8, want: 8 * time.Second},
	}
	for _, tc := range cases {
		if got := retryDelay(tc.attempt, initial, maximum); got != tc.want {
			t.Fatalf("retryDelay(%d) = %s, want %s", tc.attempt, got, tc.want)
		}
	}
}

func TestEncodeDLQPayloadPreservesMalformedSourceMessage(t *testing.T) {
	source := []byte(`{"event":`)
	raw, err := encodeDLQPayload(source)
	if err != nil {
		t.Fatalf("encodeDLQPayload() error = %v", err)
	}
	var got map[string]string
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("DLQ payload must be valid JSON: %v", err)
	}
	if got["raw_message"] != string(source) {
		t.Fatalf("raw_message = %q, want %q", got["raw_message"], source)
	}
}

func TestKafkaLag(t *testing.T) {
	cases := []struct {
		highWaterMark int64
		offset        int64
		want          float64
	}{
		{highWaterMark: 10, offset: 8, want: 1},
		{highWaterMark: 10, offset: 9, want: 0},
		{highWaterMark: 0, offset: 0, want: 0},
	}
	for _, tc := range cases {
		if got := kafkaLag(tc.highWaterMark, tc.offset); got != tc.want {
			t.Fatalf("kafkaLag(%d, %d) = %v, want %v", tc.highWaterMark, tc.offset, got, tc.want)
		}
	}
}
