package handler

import (
	"strings"
	"testing"
)

func TestNormalizeRevenueMappingInput(t *testing.T) {
	input := projectRevenueMappingInput{
		Event:          " ad_revenue ",
		AmountProperty: " revenue_micros ",
		Multiplier:     0,
	}
	if err := normalizeRevenueMappingInput(&input); err != nil {
		t.Fatalf("normalizeRevenueMappingInput() error = %v", err)
	}
	if input.Name != "ad_revenue" || input.Event != "ad_revenue" || input.AmountProperty != "revenue_micros" || input.Multiplier != 1 {
		t.Fatalf("normalized input = %#v", input)
	}

	if err := normalizeRevenueMappingInput(&projectRevenueMappingInput{Event: "ad_revenue"}); err == nil {
		t.Fatal("missing amount_property should fail")
	}
	if err := normalizeRevenueMappingInput(&projectRevenueMappingInput{Event: "ad_revenue", AmountProperty: "amount", Multiplier: -1}); err == nil {
		t.Fatal("negative multiplier should fail")
	}
}

func TestRevenueMappingExpression(t *testing.T) {
	mappings := []ProjectRevenueMapping{
		{Event: "ad_revenue", AmountProperty: "revenue", Multiplier: 0.000001, IncludeInLTV: true},
		{Event: "coin_earned", AmountProperty: "coins", Multiplier: 1, IncludeInLTV: false},
	}
	revenue, revenueArgs := revenueMappingExpression(mappings, false)
	if strings.Count(revenue, "sumIf(") != 2 || len(revenueArgs) != 6 {
		t.Fatalf("revenue expression = %q, args = %#v", revenue, revenueArgs)
	}
	ltvRevenue, ltvArgs := revenueMappingExpression(mappings, true)
	if strings.Count(ltvRevenue, "sumIf(") != 1 || len(ltvArgs) != 3 || ltvArgs[2] != "ad_revenue" {
		t.Fatalf("ltv expression = %q, args = %#v", ltvRevenue, ltvArgs)
	}
	zero, zeroArgs := revenueMappingExpression(nil, true)
	if zero != "toFloat64(0)" || len(zeroArgs) != 0 {
		t.Fatalf("empty expression = %q, args = %#v", zero, zeroArgs)
	}
}
