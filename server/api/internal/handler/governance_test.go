package handler

import "testing"

func TestOptionalPositiveInt64(t *testing.T) {
	tests := []struct {
		input string
		want  int64
		err   bool
	}{
		{input: "", want: 0},
		{input: " 42 ", want: 42},
		{input: "0", err: true},
		{input: "-1", err: true},
		{input: "abc", err: true},
	}
	for _, test := range tests {
		t.Run(test.input, func(t *testing.T) {
			got, err := optionalPositiveInt64(test.input)
			if (err != nil) != test.err {
				t.Fatalf("optionalPositiveInt64(%q) error = %v, want error=%v", test.input, err, test.err)
			}
			if got != test.want {
				t.Fatalf("optionalPositiveInt64(%q) = %d, want %d", test.input, got, test.want)
			}
		})
	}
}
