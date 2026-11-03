package handler

import "testing"

func TestNormalizeFunnelStepsKeepsLegacyEvents(t *testing.T) {
	steps, err := normalizeFunnelSteps([]string{"view", "pay"}, nil, 2, 8)
	if err != nil {
		t.Fatalf("normalize legacy events: %v", err)
	}
	if len(steps) != 2 || steps[0].Event != "view" || steps[1].Event != "pay" {
		t.Fatalf("unexpected steps: %#v", steps)
	}
}

func TestFunnelConditionUsesStepFilters(t *testing.T) {
	condition, args := funnelCondition(funnelInputStep{
		Event: "ad_show",
		Filters: []funnelStepFilter{
			{Property: "mediation", Op: "eq", Value: "admob"},
			{Property: "placement", Op: "exists"},
		},
	}, "")
	want := "event = ? AND JSONExtractRaw(properties, ?) = ? AND JSONExtractRaw(properties, ?) != ''"
	if condition != want {
		t.Fatalf("condition = %q, want %q", condition, want)
	}
	if len(args) != 4 || args[0] != "ad_show" || args[1] != "mediation" || args[3] != "placement" {
		t.Fatalf("unexpected args: %#v", args)
	}
}
