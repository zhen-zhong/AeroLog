package handler

import (
	"reflect"
	"strings"
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

func TestNormalizeBehaviorCohortRequiresEventForPropertyFilter(t *testing.T) {
	body := &behaviorQueryBody{CohortProperty: "mmp_singular_campaign_name", CohortValue: "spring"}
	if err := normalizeBehaviorCohort(body); err == nil {
		t.Fatal("property filter without cohort event must fail")
	}
}

func TestNormalizeBehaviorCohortAllowsPropertyExistenceFilter(t *testing.T) {
	body := &behaviorQueryBody{CohortEvent: " mmp_singular_install ", CohortProperty: " mmp_singular_campaign_name "}
	if err := normalizeBehaviorCohort(body); err != nil {
		t.Fatalf("cohort filter = %v", err)
	}
	if body.CohortEvent != "mmp_singular_install" || body.CohortProperty != "mmp_singular_campaign_name" {
		t.Fatalf("cohort filter was not normalized: %#v", body)
	}
}

func TestAnalyticsCohortMemberQueryAndSegmentIntersectionKeepArgumentOrder(t *testing.T) {
	cohortQuery, cohortArgs, err := analyticsCohortMemberQuery(4, 100, 200, analyticsCohortFilter{Event: "mmp_singular_install", Property: "mmp_singular_campaign_name", Value: "spring"})
	if err != nil {
		t.Fatalf("cohort query = %v", err)
	}
	query, args := intersectMemberQueries("SELECT distinct_id FROM users WHERE project_id=?", []any{uint32(4)}, cohortQuery, cohortArgs)
	if !strings.Contains(query, "distinct_id IN (SELECT DISTINCT distinct_id FROM events") {
		t.Fatalf("unexpected intersection query: %s", query)
	}
	want := []any{uint32(4), uint32(4), "mmp_singular_install", int64(100), int64(200), "mmp_singular_campaign_name", "mmp_singular_campaign_name", `"spring"`}
	if !reflect.DeepEqual(args, want) {
		t.Fatalf("args = %#v, want %#v", args, want)
	}
}
