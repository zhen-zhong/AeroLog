package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestScanDirectoryChildrenOnlyScansAllowedRootChildren(t *testing.T) {
	root := t.TempDir()
	for _, item := range []struct {
		path string
		size int
	}{{"usr/lib/firmware.bin", 4096}, {"usr/share/fonts.bin", 8192}} {
		fullPath := filepath.Join(root, item.path)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(fullPath, make([]byte, item.size), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	service := &inspector{root: root}
	data := service.scanDirectoryChildren(context.Background(), "/usr")
	if len(data) != 2 || data[0].Path != "/usr/share" || data[1].Path != "/usr/lib" {
		t.Fatalf("unexpected detail result: %#v", data)
	}
	if !isAllowedDirectory("/usr") || isAllowedDirectory("/etc") || isAllowedDirectory("/usr/local") {
		t.Fatal("allowed directory validation is incorrect")
	}
}
