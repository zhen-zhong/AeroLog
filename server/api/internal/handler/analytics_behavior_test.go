package handler

import (
	"testing"
	"time"
)

func TestSplitBehaviorSessionsSplitsOnGapAndDeduplicatesAdjacentEvents(t *testing.T) {
	start := time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC)
	sessions := splitBehaviorSessions([]behaviorEvent{
		{DistinctID: "u1", Event: "$AppStart", Time: start},
		{DistinctID: "u1", Event: "$AppStart", Time: start.Add(time.Minute)},
		{DistinctID: "u1", Event: "ad_show", Time: start.Add(2 * time.Minute)},
		{DistinctID: "u1", Event: "coin_earned", Time: start.Add(25 * time.Minute)},
		{DistinctID: "u2", Event: "$AppStart", Time: start.Add(time.Minute)},
	}, 20*60)
	if len(sessions) != 3 {
		t.Fatalf("sessions = %d, want 3", len(sessions))
	}
	if got := sessions[0].Events; len(got) != 2 || got[0] != "$AppStart" || got[1] != "ad_show" {
		t.Fatalf("first events = %#v", got)
	}
}

func TestBuildPathsUsesStartEventAndTopNodes(t *testing.T) {
	sessions := []behaviorSession{
		{Events: []string{"open", "ad_show", "coin"}},
		{Events: []string{"open", "ad_show", "shop"}},
		{Events: []string{"other", "shop"}},
	}
	nodes, edges, matched := buildPaths(sessions, "open", 3, 3)
	if matched != 2 || len(nodes) != 3 || len(edges) != 2 {
		t.Fatalf("matched=%d nodes=%d edges=%d", matched, len(nodes), len(edges))
	}
	if nodes[0].Name != "open" || nodes[0].Count != 2 {
		t.Fatalf("top node = %#v", nodes[0])
	}
}
