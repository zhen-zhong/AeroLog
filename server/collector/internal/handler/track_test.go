package handler

import (
	"testing"

	"github.com/aerolog/server/pkg/model"
)

func TestEventPropertyString(t *testing.T) {
	event := &model.Event{Properties: map[string]interface{}{
		"$insert_id": "  insert-1  ",
		"number":     float64(1),
	}}
	if got := eventPropertyString(event, "$insert_id"); got != "insert-1" {
		t.Fatalf("eventPropertyString() = %q", got)
	}
	if got := eventPropertyString(event, "number"); got != "" {
		t.Fatalf("non-string property = %q", got)
	}
}
