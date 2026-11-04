package handler

import (
	"testing"
	"time"
)

func TestDecodeSegmentationDays(t *testing.T) {
	rows, err := decodeSegmentationDays([]byte(`{
		"rows":[
			{"date":"2026-11-01","all_events":12,"all_users":"5","event_ad_show":7},
			{"by_value":"2026-11-02 00:00:00","all_events":"9","all_users":4,"event_meta_AppStart":3}
		]
	}`))
	if err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if rows["2026-11-01"].SensorsEvents != 12 || rows["2026-11-01"].SensorsMergedUsers != 5 || rows["2026-11-01"].SensorsByEvent["ad_show"] != 7 {
		t.Fatalf("unexpected first row: %#v", rows["2026-11-01"])
	}
	if rows["2026-11-02"].SensorsByEvent["$AppStart"] != 3 {
		t.Fatalf("unexpected second row: %#v", rows["2026-11-02"])
	}
}

func TestDecodeSegmentationDetailRows(t *testing.T) {
	rows, err := decodeSegmentationDays([]byte(`{
		"metadata_columns":{"date":"DATE","all_events":"DOUBLE","all_users":"DOUBLE","event_ad_show":"DOUBLE"},
		"detail_rows":[["2026-11-01 00:00:00","12","5","7"]]
	}`))
	if err != nil {
		t.Fatalf("decode error: %v", err)
	}
	row := rows["2026-11-01"]
	if row.SensorsEvents != 12 || row.SensorsMergedUsers != 5 || row.SensorsByEvent["ad_show"] != 7 {
		t.Fatalf("unexpected row: %#v", row)
	}
}

func TestMergeReconciliationDaysIncludesMissingDays(t *testing.T) {
	from := mustReconciliationDate(t, "2026-11-01")
	to := mustReconciliationDate(t, "2026-11-03")
	rows := mergeReconciliationDays(from, to,
		map[string]sensorsReconciliationDay{"2026-11-01": {SensorsEvents: 2}},
		map[string]sensorsReconciliationDay{"2026-11-03": {AeroLogEvents: 3}},
		nil,
		"UTC",
	)
	if len(rows) != 3 || rows[1].Date != "2026-11-02" || rows[2].AeroLogEvents != 3 || rows[0].CoverageStatus != "pending" {
		t.Fatalf("unexpected rows: %#v", rows)
	}
}

func TestReconciliationCoverageStatusUsesProjectTimezone(t *testing.T) {
	startedAt := time.Date(2026, 11, 3, 0, 30, 0, 0, time.UTC)
	if got := reconciliationCoverageStatus("2026-11-02", &startedAt, "Asia/Shanghai"); got != "not_covered" {
		t.Fatalf("expected not_covered, got %q", got)
	}
	if got := reconciliationCoverageStatus("2026-11-03", &startedAt, "Asia/Shanghai"); got != "partial" {
		t.Fatalf("expected partial, got %q", got)
	}
	if got := reconciliationCoverageStatus("2026-11-04", &startedAt, "Asia/Shanghai"); got != "covered" {
		t.Fatalf("expected covered, got %q", got)
	}
}

func TestReconciliationDateRangeUsesProjectTimezone(t *testing.T) {
	from, to := reconciliationDateRange("Asia/Shanghai", 3)
	if from.Location().String() != "Asia/Shanghai" || to.Sub(from) < 47*time.Hour || to.Sub(from) > 49*time.Hour {
		t.Fatalf("unexpected range: %s to %s", from, to)
	}
}

func mustReconciliationDate(t *testing.T, value string) time.Time {
	t.Helper()
	date, err := time.Parse("2006-01-02", value)
	if err != nil {
		t.Fatal(err)
	}
	return date
}
