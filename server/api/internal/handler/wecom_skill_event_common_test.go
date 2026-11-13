package handler

import "testing"

func TestResolveWecomEventsUsesOnlyKnownEvents(t *testing.T) {
	known := []string{"$AppStart", "ad_show", "ad_complete"}
	got, err := resolveWecomEvents("比较 ad_show 和 ad_complete 的事件次数", nil, known, 1, 10)
	if err != nil || len(got) != 2 || got[0] != "ad_show" || got[1] != "ad_complete" {
		t.Fatalf("resolveWecomEvents() = %#v, %v", got, err)
	}
	if _, err := resolveWecomEvents("未知事件", []string{"unknown_event"}, known, 1, 10); err == nil {
		t.Fatal("unknown event must be rejected")
	}
}

func TestResolveWecomEventsRespectsBounds(t *testing.T) {
	known := []string{"a", "b", "c"}
	if _, err := resolveWecomEvents("", []string{"a"}, known, 2, 5); err == nil {
		t.Fatal("too few funnel steps must be rejected")
	}
}
