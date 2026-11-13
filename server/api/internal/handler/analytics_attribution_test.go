package handler

import (
	"reflect"
	"strings"
	"testing"
)

func TestAttributionBuildCTEPlacesDimensionArgumentAtItsPlaceholder(t *testing.T) {
	body := &attributionRequest{
		ConversionEvent: "pay_success",
		TouchEvents:     []string{"page_view", "add_to_cart"},
		From:            100,
		To:              200,
		WindowSeconds:   3600,
	}

	cte, args := attributionBuildCTE(42, body, "channel", "", nil)
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
	body := &attributionRequest{
		ConversionEvent: "pay_success",
		TouchEvents:     []string{"page_view"},
		From:            100,
		To:              200,
		WindowSeconds:   3600,
	}

	cte, args := attributionBuildCTE(42, body, "", "", nil)
	if strings.Contains(cte, " AS dim") {
		t.Fatal("non-breakdown CTE must not select a dimension")
	}
	if got, want := strings.Count(cte, "?"), len(args); got != want {
		t.Fatalf("placeholder count = %d, want %d", got, want)
	}
}

func TestAttributionBuildCTEAppliesSegmentMembershipToConversions(t *testing.T) {
	body := &attributionRequest{
		ConversionEvent: "pay_success",
		TouchEvents:     []string{"page_view"},
		From:            100,
		To:              200,
		WindowSeconds:   3600,
	}

	cte, args := attributionBuildCTE(42, body, "", "SELECT distinct_id FROM users WHERE project_id=?", []any{uint32(42)})
	if !strings.Contains(cte, "distinct_id IN (SELECT distinct_id FROM users WHERE project_id=?)") {
		t.Fatalf("segment membership missing from conversion CTE: %s", cte)
	}
	want := []any{uint32(42), "pay_success", int64(100), int64(200), uint32(42), uint32(42), int64(100), int64(200), int64(3600), "page_view"}
	if !reflect.DeepEqual(args, want) {
		t.Fatalf("unexpected CTE arguments\nwant: %#v\n got: %#v", want, args)
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

func TestParseDimensionValueKeepsTimeBucketAsText(t *testing.T) {
	value, label := parseDimensionValue("time", "2026-10-22 14:00")
	if value != "2026-10-22 14:00" || label != "2026-10-22 14:00" {
		t.Fatalf("time bucket parsed unexpectedly: value=%#v label=%q", value, label)
	}
}

func TestParseDimensionValueUsesEmptyTimeLabelForEmptyTimeBucket(t *testing.T) {
	_, label := parseDimensionValue("time", "")
	if label != "(空时间)" {
		t.Fatalf("empty time label = %q, want (空时间)", label)
	}
}
