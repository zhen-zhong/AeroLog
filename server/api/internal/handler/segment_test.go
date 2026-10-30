package handler

import "testing"

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
		{name: "no condition", input: SegmentRules{}, wantErr: true},
		{name: "invalid condition", input: SegmentRules{Event: "ad_show", EventCondition: "maybe"}, wantErr: true},
		{name: "invalid lookback", input: SegmentRules{Event: "ad_show", LookbackDays: 366}, wantErr: true},
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
			if got != test.want {
				t.Fatalf("got %#v, want %#v", got, test.want)
			}
		})
	}
}
