package sensorsdata

import "testing"

func TestDecodeFlatten(t *testing.T) {
	raw := []byte(`{
  "organization_id":"org-1",
  "project":"RbowDrama",
  "project_id":29,
  "trace_id":"trace-1",
  "operation_type":"UPSERT",
  "event":"$AppStart",
  "distinct_id":"device-1",
  "time":1792558800000,
  "update_time":1792558801000,
  "identities":{"$identity_login_id":"user-1","$identity_anonymous_id":"anon-1"},
  "properties":{"$lib":"Android","$lib_version":"6.6.0","$receive_time":1792558802000,"$os":"Android"}
}`)

	got, err := DecodeFlatten(raw, 7)
	if err != nil {
		t.Fatalf("DecodeFlatten() error = %v", err)
	}
	if got.ProjectID != 7 || got.Event.Event != "$AppStart" || got.Event.DistinctID != "device-1" {
		t.Fatalf("unexpected mapped event: %#v", got)
	}
	if got.Event.UserID != "user-1" || got.Event.AnonymousID != "anon-1" {
		t.Fatalf("identity mapping failed: %#v", got.Event)
	}
	if got.ReceivedAt != 1792558802000 || got.Event.Lib.Name != "Android" || got.Event.Lib.Version != "6.6.0" {
		t.Fatalf("context mapping failed: %#v", got)
	}
	if got.Event.Properties["$aerolog_source"] != "sensorsdata" || got.Event.Properties["$sensorsdata_project_id"] != float64(29) {
		t.Fatalf("source metadata missing: %#v", got.Event.Properties)
	}
}

func TestDecodeFlattenRejectsInvalidInput(t *testing.T) {
	if _, err := DecodeFlatten([]byte(`{"event":"x"}`), 7); err == nil {
		t.Fatal("expected missing fields to fail")
	}
	if _, err := DecodeFlatten([]byte(`{}`), 0); err == nil {
		t.Fatal("expected missing target project to fail")
	}
}
