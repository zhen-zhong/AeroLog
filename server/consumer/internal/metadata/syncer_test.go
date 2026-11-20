package metadata

import (
	"testing"
	"time"
)

func TestMergeRelationKeepsRangeAndMixedType(t *testing.T) {
	key := propRelationKey{projectID: 4, event: "$AppViewScreen", name: "$os"}
	relations := map[propRelationKey]seenProp{}
	later := time.Date(2026, 11, 20, 8, 0, 0, 0, time.UTC)
	earlier := later.Add(-time.Hour)

	mergeRelation(relations, key, "string", later)
	mergeRelation(relations, key, "number", earlier)

	got := relations[key]
	if !got.first.Equal(earlier) || !got.last.Equal(later) {
		t.Fatalf("时间范围错误: first=%s last=%s", got.first, got.last)
	}
	if got.dataType != "mixed" {
		t.Fatalf("dataType=%q, want mixed", got.dataType)
	}
}
