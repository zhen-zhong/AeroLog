package worker

import (
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
