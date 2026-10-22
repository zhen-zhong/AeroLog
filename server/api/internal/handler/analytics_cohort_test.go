package handler

import (
	"reflect"
	"testing"
)

func TestNormalizeCohortOffsetsDefaultsAndSorts(t *testing.T) {
	got, ok := normalizeCohortOffsets([]int{2, 0, 2, 1})
	if !ok {
		t.Fatal("valid offsets rejected")
	}
	if want := []int{0, 1, 2}; !reflect.DeepEqual(got, want) {
		t.Fatalf("offsets = %#v, want %#v", got, want)
	}

	defaults, ok := normalizeCohortOffsets(nil)
	if !ok || !reflect.DeepEqual(defaults, []int{0, 1}) {
		t.Fatalf("defaults = %#v, ok=%v", defaults, ok)
	}
}

func TestNormalizeCohortOffsetsRejectsOutOfRange(t *testing.T) {
	if _, ok := normalizeCohortOffsets([]int{-1}); ok {
		t.Fatal("negative offset accepted")
	}
	if _, ok := normalizeCohortOffsets([]int{31}); ok {
		t.Fatal("offset over 30 accepted")
	}
}
