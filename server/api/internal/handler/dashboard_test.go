package handler

import (
	"encoding/json"
	"testing"
)

func TestNormalizeDashboardBody(t *testing.T) {
	body := dashboardBody{Name: "  广告经营看板  ", GlobalConfig: json.RawMessage(`{"range":"7d"}`)}
	if err := normalizeDashboardBody(&body); err != nil {
		t.Fatal(err)
	}
	if body.Name != "广告经营看板" || string(body.GlobalConfig) != `{"range":"7d"}` || string(body.DraftConfig) != `{}` {
		t.Fatalf("unexpected body: %#v", body)
	}
}

func TestNormalizeDashboardWidgetBodyRejectsUnknownType(t *testing.T) {
	body := dashboardWidgetBody{Title: "测试", WidgetType: "sql", SourceType: "custom_report"}
	if err := normalizeDashboardWidgetBody(&body); err == nil {
		t.Fatal("unknown widget type must be rejected")
	}
}

func TestNormalizeDashboardWidgetBodyAcceptsFunnel(t *testing.T) {
	body := dashboardWidgetBody{Title: "转化漏斗", WidgetType: "funnel", SourceType: "funnel", QueryConfig: json.RawMessage(`{"events":["a","b"]}`)}
	if err := normalizeDashboardWidgetBody(&body); err != nil {
		t.Fatal(err)
	}
}

func TestNormalizedJSONObjectAllowsWhitespace(t *testing.T) {
	got := normalizedJSONObject(json.RawMessage("  {\"range\":\"7d\"}  "))
	if string(got) != `{"range":"7d"}` {
		t.Fatalf("unexpected normalized JSON: %s", got)
	}
}

func TestOverallDimensionLabel(t *testing.T) {
	value, label := parseDimensionValue("overall", "all")
	if value != "all" || label != "总体" {
		t.Fatalf("unexpected overall dimension: %#v, %s", value, label)
	}
}

func TestOffsetDashboardLayout(t *testing.T) {
	got := offsetDashboardLayout(json.RawMessage(`{"x":2,"y":4,"w":6,"h":5}`))
	var layout map[string]float64
	if err := json.Unmarshal(got, &layout); err != nil {
		t.Fatal(err)
	}
	if layout["x"] != 2 || layout["y"] != 5 {
		t.Fatalf("unexpected copied layout: %s", got)
	}
}
