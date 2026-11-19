package pgschema

import "testing"

func TestRetentionPolicyNormalize(t *testing.T) {
	got := (RetentionPolicy{}).Normalize()
	want := RetentionPolicy{
		DebugAcceptedDays: 7,
		DebugErrorDays:    30,
		SchemaIssueDays:   30,
		AnalyticsJobDays:  7,
		SessionGraceDays:  7,
	}
	if got != want {
		t.Fatalf("Normalize() = %#v, want %#v", got, want)
	}
}

func TestRetentionPolicyNormalizeKeepsPositiveValues(t *testing.T) {
	want := RetentionPolicy{
		DebugAcceptedDays: 2,
		DebugErrorDays:    14,
		SchemaIssueDays:   60,
		AnalyticsJobDays:  3,
		SessionGraceDays:  1,
	}
	if got := want.Normalize(); got != want {
		t.Fatalf("Normalize() = %#v, want %#v", got, want)
	}
}
