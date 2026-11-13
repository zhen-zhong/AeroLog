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

func TestDecodeFlattenNormalizesSingularAttribution(t *testing.T) {
	raw := []byte(`{
  "event":"mmp_singular_install",
  "distinct_id":"device-1",
  "time":1792558800000,
  "properties":{
    "mmp_singular_network_name":"Meta Ads",
    "mmp_singular_campaign_name":"Spring Launch",
    "mmp_singular_campaign_id":"campaign-1",
    "mmp_singular_subcampaign_name":"Group A",
    "mmp_singular_creative_name":"Creative 01",
    "mmp_singular_attribution_country":"US"
  }
}`)
	got, err := DecodeFlatten(raw, 7)
	if err != nil {
		t.Fatalf("DecodeFlatten() error = %v", err)
	}
	for key, want := range map[string]string{
		"mmp_media_source":  "Meta Ads",
		"mmp_campaign_name": "Spring Launch",
		"mmp_campaign_id":   "campaign-1",
		"mmp_ad_group_name": "Group A",
		"mmp_creative_name": "Creative 01",
		"mmp_country":       "US",
	} {
		if got.Event.Properties[key] != want {
			t.Fatalf("%s = %#v, want %q", key, got.Event.Properties[key], want)
		}
	}
}

func TestNormalizeSingularAttributionKeepsExistingCanonicalValue(t *testing.T) {
	props := map[string]interface{}{
		"mmp_media_source":          "Google Ads",
		"mmp_singular_network_name": "Meta Ads",
	}
	normalizeSingularAttributionProperties(props)
	if got := props["mmp_media_source"]; got != "Google Ads" {
		t.Fatalf("mmp_media_source = %#v, want existing value", got)
	}
}

func TestDecodeFlattenProfile(t *testing.T) {
	raw := []byte(`{
  "operation_type":"SET",
  "distinct_id":"user-1",
  "time":1792558800000,
  "identities":{"$identity_login_id":"member-1","$identity_anonymous_id":"anon-1"},
  "properties":{"nickname":"Aero","level":3}
}`)

	got, err := DecodeFlattenProfile(raw, 7)
	if err != nil {
		t.Fatalf("DecodeFlattenProfile() error = %v", err)
	}
	if got.ProjectID != 7 || got.Event.Type != "profile_set" || got.Event.DistinctID != "user-1" {
		t.Fatalf("unexpected mapped profile: %#v", got)
	}
	if got.Event.UserID != "member-1" || got.Event.AnonymousID != "anon-1" || got.Event.Properties["nickname"] != "Aero" {
		t.Fatalf("profile identity or properties mapping failed: %#v", got.Event)
	}
}

func TestDecodeFlattenProfileRejectsUnsupportedOperation(t *testing.T) {
	if _, err := DecodeFlattenProfile([]byte(`{"operation_type":"APPEND","distinct_id":"user-1","time":1792558800000}`), 7); err == nil {
		t.Fatal("expected unsupported profile operation to fail")
	}
}

func TestDecodeFlattenRoutedUsesSourceProject(t *testing.T) {
	router := NewProjectRouter(nil, 9)
	got, err := DecodeFlattenRouted([]byte(`{"project_id":29,"event":"ad_show","distinct_id":"device-1","time":1792558800000,"properties":{}}`), router)
	if err != nil {
		t.Fatalf("DecodeFlattenRouted() error = %v", err)
	}
	if got.ProjectID != 9 {
		t.Fatalf("got project %d, want fallback 9", got.ProjectID)
	}
}

func TestDecodeFlattenRoutedRejectsMissingMapping(t *testing.T) {
	_, err := DecodeFlattenRouted([]byte(`{"project_id":29,"event":"ad_show","distinct_id":"device-1","time":1792558800000,"properties":{}}`), NewProjectRouter(nil, 0))
	if err == nil {
		t.Fatal("expected missing route to fail")
	}
}
