package handler

import (
	"encoding/json"
	"testing"
	"time"
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

func TestNormalizeDashboardMonitoringBodies(t *testing.T) {
	subscription := dashboardSubscriptionBody{Cadence: "weekly", SendHour: 9, Weekday: 1}
	if err := normalizeDashboardSubscription(&subscription); err != nil {
		t.Fatal(err)
	}
	rule := dashboardAlertRuleBody{
		Name: "广告展示过低", Metric: "event_count", Event: "ad_show",
		Operator: "lt", Threshold: 10, WindowMinutes: 60, CooldownMinutes: 360, Enabled: true,
	}
	if err := normalizeDashboardAlertRule(&rule); err != nil {
		t.Fatal(err)
	}
	rule.WindowMinutes = 30
	if err := normalizeDashboardAlertRule(&rule); err == nil {
		t.Fatal("unsupported window must be rejected")
	}
}

func TestDashboardRuleTriggered(t *testing.T) {
	cases := []struct {
		value, threshold float64
		operator         string
		want             bool
	}{
		{11, 10, "gt", true},
		{10, 10, "gte", true},
		{9, 10, "lt", true},
		{10, 10, "lte", true},
		{10, 10, "gt", false},
	}
	for _, item := range cases {
		if got := dashboardRuleTriggered(item.value, item.operator, item.threshold); got != item.want {
			t.Fatalf("dashboardRuleTriggered(%v,%s,%v)=%v", item.value, item.operator, item.threshold, got)
		}
	}
}

func TestDashboardSubscriptionPeriod(t *testing.T) {
	location := time.FixedZone("UTC+8", 8*3600)
	now := time.Date(2026, 11, 23, 9, 5, 0, 0, location) // Monday
	start, end, key, due := dashboardSubscriptionPeriod(now, "daily", 9, 1)
	if !due || key != "daily:2026-11-22" || start.Day() != 22 || end.Day() != 23 {
		t.Fatalf("unexpected daily period: %v %v %s %v", start, end, key, due)
	}
	start, end, key, due = dashboardSubscriptionPeriod(now, "weekly", 9, 1)
	if !due || key != "weekly:2026-11-16" || start.Day() != 16 || end.Day() != 23 {
		t.Fatalf("unexpected weekly period: %v %v %s %v", start, end, key, due)
	}
	_, _, _, due = dashboardSubscriptionPeriod(now.Add(-time.Hour), "daily", 9, 1)
	if due {
		t.Fatal("subscription must not run before configured hour")
	}
}
