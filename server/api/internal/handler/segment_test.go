package handler

import (
	"reflect"
	"testing"
)

func TestNormalizeSegmentRules(t *testing.T) {
	tests := []struct {
		name    string
		input   SegmentRules
		want    SegmentRules
		wantErr bool
	}{
		{
			name:  "event defaults",
			input: SegmentRules{Event: " ad_show "},
			want:  SegmentRules{Event: "ad_show", EventCondition: "has", LookbackDays: 30},
		},
		{
			name:  "profile only clears event settings",
			input: SegmentRules{ProfileProperty: " platform ", ProfileValue: " Android ", EventCondition: "has", LookbackDays: 7},
			want:  SegmentRules{ProfileProperty: "platform", ProfileValue: "Android"},
		},
		{
			name:  "not has event",
			input: SegmentRules{Event: "ad_show", EventCondition: "not_has", LookbackDays: 7},
			want:  SegmentRules{Event: "ad_show", EventCondition: "not_has", LookbackDays: 7},
		},
		{
			name:  "event property condition",
			input: SegmentRules{Event: " mmp_singular_install ", EventProperty: " mmp_singular_campaign_name ", EventValue: " spring "},
			want:  SegmentRules{Event: "mmp_singular_install", EventCondition: "has", EventProperty: "mmp_singular_campaign_name", EventValue: "spring", LookbackDays: 30},
		},
		{
			name:  "multiple event conditions",
			input: SegmentRules{Event: "ad_show", EventRules: []SegmentEventRule{{Event: " ad_complete ", Condition: "not_has", Property: " ad_unit ", Value: "rewarded", LookbackDays: 7}}},
			want:  SegmentRules{Event: "ad_show", EventCondition: "has", LookbackDays: 30, EventRules: []SegmentEventRule{{Event: "ad_complete", Condition: "not_has", Property: "ad_unit", Value: "rewarded", LookbackDays: 7}}},
		},
		{name: "no condition", input: SegmentRules{}, wantErr: true},
		{name: "invalid condition", input: SegmentRules{Event: "ad_show", EventCondition: "maybe"}, wantErr: true},
		{name: "invalid lookback", input: SegmentRules{Event: "ad_show", LookbackDays: 366}, wantErr: true},
		{name: "event value without property", input: SegmentRules{Event: "ad_show", EventValue: "yes"}, wantErr: true},
		{name: "extra event value without property", input: SegmentRules{EventRules: []SegmentEventRule{{Event: "ad_show", Value: "yes"}}}, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := normalizeSegmentRules(test.input)
			if test.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("got %#v, want %#v", got, test.want)
			}
		})
	}
}
