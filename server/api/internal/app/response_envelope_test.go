package app

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestWrapAPIResponseSuccess(t *testing.T) {
	payload, err := wrapAPIResponse(http.StatusOK, []byte(`{"data":[{"name":"signup"}]}`))
	if err != nil {
		t.Fatalf("wrapAPIResponse returned error: %v", err)
	}

	var got map[string]interface{}
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if got["code"].(float64) != 0 {
		t.Fatalf("code = %v, want 0", got["code"])
	}
	if got["message"] != "ok" {
		t.Fatalf("message = %v, want ok", got["message"])
	}
	if _, ok := got["data"].([]interface{}); !ok {
		t.Fatalf("data = %#v, want array", got["data"])
	}
}

func TestWrapAPIResponseError(t *testing.T) {
	payload, err := wrapAPIResponse(http.StatusBadRequest, []byte(`{"err":"name required"}`))
	if err != nil {
		t.Fatalf("wrapAPIResponse returned error: %v", err)
	}

	var got map[string]interface{}
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if got["code"].(float64) != http.StatusBadRequest {
		t.Fatalf("code = %v, want %d", got["code"], http.StatusBadRequest)
	}
	if got["message"] != "name required" {
		t.Fatalf("message = %v, want name required", got["message"])
	}
	if got["data"] != nil {
		t.Fatalf("data = %#v, want nil", got["data"])
	}
}
