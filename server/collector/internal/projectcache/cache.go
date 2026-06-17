// Package projectcache 缓存 token → project_id 映射，避免每次请求都查 Postgres。
package projectcache

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type entry struct {
	projectID uint32
	secret    string
	expireAt  time.Time
}

// Cache 内存 LRU-lite 缓存（按 token 维度）
type Cache struct {
	mu    sync.RWMutex
	items map[string]entry
	pool  *pgxpool.Pool
	ttl   time.Duration
}

// New 构造一个 Cache
func New(pool *pgxpool.Pool, ttl time.Duration) *Cache {
	if ttl <= 0 {
		ttl = 60 * time.Second
	}
	return &Cache{items: make(map[string]entry), pool: pool, ttl: ttl}
}

// Resolve 根据 token 解析 project_id；命中缓存则直接返回，否则查 DB。
func (c *Cache) Resolve(ctx context.Context, token string) (uint32, error) {
	pid, _, err := c.ResolveProject(ctx, token)
	return pid, err
}

// ResolveProject 根据 token 解析 project_id 和 secret。
func (c *Cache) ResolveProject(ctx context.Context, token string) (uint32, string, error) {
	if token == "" {
		return 0, "", errors.New("empty token")
	}
	c.mu.RLock()
	if e, ok := c.items[token]; ok && time.Now().Before(e.expireAt) {
		c.mu.RUnlock()
		return e.projectID, e.secret, nil
	}
	c.mu.RUnlock()

	var pid uint32
	var secret string
	err := c.pool.QueryRow(ctx,
		`SELECT id, secret FROM projects WHERE token=$1 AND status=1`, token).Scan(&pid, &secret)
	if err != nil {
		return 0, "", err
	}
	c.mu.Lock()
	c.items[token] = entry{projectID: pid, secret: secret, expireAt: time.Now().Add(c.ttl)}
	c.mu.Unlock()
	return pid, secret, nil
}
