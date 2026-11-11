package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

const tokenHeader = "X-AeroLog-Host-Inspector-Token"

var allowedDirectories = []string{
	"/var/lib/aerolog",
	"/var/lib/docker",
	"/opt",
	"/usr",
	"/home",
	"/var/log",
	"/var/cache",
	"/tmp",
}

type directorySize struct {
	Path      string `json:"path"`
	Bytes     int64  `json:"bytes"`
	Completed bool   `json:"completed"`
}

type inspector struct {
	token string
	root  string
	mu    sync.Mutex
	cache struct {
		at   time.Time
		data []directorySize
	}
}

func main() {
	token := strings.TrimSpace(os.Getenv("AEROLOG_HOST_INSPECTOR_TOKEN"))
	if token == "" {
		log.Fatal("AEROLOG_HOST_INSPECTOR_TOKEN is required")
	}
	root := strings.TrimRight(strings.TrimSpace(os.Getenv("AEROLOG_HOST_ROOT")), "/")
	if root == "" {
		root = "/host"
	}
	service := &inspector{token: token, root: root}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", service.health)
	mux.HandleFunc("/v1/disk-usage", service.diskUsage)
	addr := os.Getenv("AEROLOG_HOST_INSPECTOR_ADDR")
	if addr == "" {
		addr = ":8086"
	}
	log.Printf("host inspector listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func (s *inspector) health(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func (s *inspector) diskUsage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet || subtle.ConstantTimeCompare([]byte(r.Header.Get(tokenHeader)), []byte(s.token)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	data := s.cachedScan(r.Context())
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"checked_at":  time.Now().UTC().Format(time.RFC3339),
		"scope":       "只读白名单目录；实际分配磁盘块，硬链接去重，符号链接不跟随",
		"directories": data,
	})
}

func (s *inspector) cachedScan(ctx context.Context) []directorySize {
	s.mu.Lock()
	defer s.mu.Unlock()
	if time.Since(s.cache.at) < 10*time.Minute && len(s.cache.data) > 0 {
		return s.cache.data
	}
	scanCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	data := make([]directorySize, 0, len(allowedDirectories))
	seen := map[[2]uint64]struct{}{}
	for _, path := range allowedDirectories {
		data = append(data, s.scanDirectory(scanCtx, path, seen))
	}
	sort.Slice(data, func(i, j int) bool { return data[i].Bytes > data[j].Bytes })
	s.cache.at = time.Now()
	s.cache.data = data
	return data
}

func (s *inspector) scanDirectory(ctx context.Context, path string, seen map[[2]uint64]struct{}) directorySize {
	item := directorySize{Path: path, Completed: true}
	root := filepath.Join(s.root, path)
	if _, err := os.Stat(root); err != nil {
		item.Completed = false
		return item
	}
	err := filepath.WalkDir(root, func(_ string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil // unreadable child: retain partial aggregate without disclosing paths
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if entry.Type().IsRegular() {
			if info, err := entry.Info(); err == nil {
				item.Bytes += allocatedBytes(info, seen)
			}
		}
		return nil
	})
	if err != nil && !errors.Is(err, filepath.SkipDir) {
		item.Completed = false
	}
	return item
}

// allocatedBytes 返回实际分配磁盘块，而非逻辑文件长度。Docker overlay
// 层包含稀疏文件和硬链接；若直接累计逻辑大小，会使目录总量远大于实际磁盘占用。
func allocatedBytes(info os.FileInfo, seen map[[2]uint64]struct{}) int64 {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return info.Size()
	}
	key := [2]uint64{uint64(stat.Dev), uint64(stat.Ino)}
	if _, exists := seen[key]; exists {
		return 0
	}
	seen[key] = struct{}{}
	return stat.Blocks * 512
}
