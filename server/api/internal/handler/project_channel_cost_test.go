package handler

import "testing"

func TestNormalizeProjectChannelCostInput(t *testing.T) {
	input := projectChannelCostInput{
		CostDate:    " 2026-11-13 ",
		MediaSource: " Google Ads ",
		Cost:        12.5,
		Currency:    " usd ",
	}
	if err := normalizeProjectChannelCostInput(&input); err != nil {
		t.Fatalf("normalizeProjectChannelCostInput() error = %v", err)
	}
	if input.CostDate != "2026-11-13" || input.MediaSource != "Google Ads" || input.Currency != "USD" || input.Source != "manual" {
		t.Fatalf("normalized input = %#v", input)
	}

	if err := normalizeProjectChannelCostInput(&projectChannelCostInput{CostDate: "2026-11-13", Cost: 1}); err == nil {
		t.Fatal("missing media source should fail")
	}
	if err := normalizeProjectChannelCostInput(&projectChannelCostInput{CostDate: "2026-11-13", MediaSource: "Google Ads", Cost: -1}); err == nil {
		t.Fatal("negative cost should fail")
	}
}
