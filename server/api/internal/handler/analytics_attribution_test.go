package handler

import (
	"reflect"
	"strings"
	"testing"
)

func TestAttributionBuildCTEPlacesDimensionArgumentAtItsPlaceholder(t *testing.T) {
	body := &struct {
		ConversionEvent   string   `json:"conversion_event"`
		TouchEvents       []string `json:"touch_events"`
		From              int64    `json:"from"`
		To                int64    `json:"to"`
		WindowSeconds     int64    `json:"window_seconds"`
		Model             string   `json:"model"`
		BreakdownProperty string   `json:"breakdown_property"`
	}{
		ConversionEvent: "pay_success",
		TouchEvents:     []string{"page_view", "add_to_cart"},
		From:            100,
		To:              200,
		WindowSeconds:   3600,
	}

	cte, args := attributionBuildCTE(42, body, "channel")
	want := []any{
		uint32(42), "pay_success", int64(100), int64(200),
		"channel", // JSONExtractRaw(e.properties, ?) appears after the conv CTE.
		uint32(42), int64(100), int64(200), int64(3600),
		"page_view", "add_to_cart",
	}
	if !reflect.DeepEqual(args, want) {
		t.Fatalf("unexpected CTE arguments\nwant: %#v\n got: %#v", want, args)
	}
	if got, wantCount := strings.Count(cte, "?"), len(args); got != wantCount {
		t.Fatalf("placeholder count = %d, want %d", got, wantCount)
	}
}

func TestAttributionBuildCTEOmitsDimensionArgumentWithoutBreakdown(t *testing.T) {
	body := &struct {
		ConversionEvent   string   `json:"conversion_event"`
		TouchEvents       []string `json:"touch_events"`
		From              int64    `json:"from"`
		To                int64    `json:"to"`
		WindowSeconds     int64    `json:"window_seconds"`
		Model             string   `json:"model"`
		BreakdownProperty string   `json:"breakdown_property"`
	}{
		ConversionEvent: "pay_success",
		TouchEvents:     []string{"page_view"},
		From:            100,
		To:              200,
		WindowSeconds:   3600,
	}

	cte, args := attributionBuildCTE(42, body, "")
	if strings.Contains(cte, " AS dim") {
		t.Fatal("non-breakdown CTE must not select a dimension")
	}
	if got, want := strings.Count(cte, "?"), len(args); got != want {
		t.Fatalf("placeholder count = %d, want %d", got, want)
	}
}

func TestLimitAttributionBreakdownKeepsTopGroupsWithoutMerging(t *testing.T) {
	rows := []attributionBreakdownGroup{
		{Raw: `"search"`, Label: "search", TotalCredit: 3},
		{Raw: `"email"`, Label: "email", TotalCredit: 2},
		{Raw: `"social"`, Label: "social", TotalCredit: 1},
	}

	got, truncated := limitAttributionBreakdown(rows, 2)
	if !truncated || len(got) != 2 {
		t.Fatalf("got truncated=%v and %d groups, want true and 2", truncated, len(got))
	}
	if got[0].Raw != `"search"` || got[1].Raw != `"email"` {
		t.Fatalf("expected the first two groups to remain, got %#v", got)
	}
}
