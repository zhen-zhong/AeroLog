// Package app wires the API service dependencies, router, and lifecycle.
package app

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/aerolog/server/api/internal/config"
	"github.com/aerolog/server/api/internal/handler"
	"github.com/aerolog/server/pkg/metrics"
	"github.com/aerolog/server/pkg/pgschema"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	mReqDuration = metrics.Histogram(
		"aerolog_api_request_duration_seconds",
		"API 请求耗时",
		"method", "path", "status",
	)
	mReqTotal = metrics.Counter(
		"aerolog_api_requests_total",
		"API 请求总数",
		"method", "path", "status",
	)
)

// App owns the API service runtime dependencies.
type App struct {
	cfg        *config.Config
	pgPool     *pgxpool.Pool
	chConn     driver.Conn
	httpServer *http.Server
	metricsSrv *http.Server
	queryJobs  *handler.QueryHandler
}

// New builds the API service without starting listeners.
func New(ctx context.Context, cfg *config.Config) (*App, error) {
	pool, err := pgxpool.New(ctx, cfg.PostgresDSN)
	if err != nil {
		return nil, err
	}
	if err := pgschema.Ensure(ctx, pool); err != nil {
		pool.Close()
		return nil, err
	}

	chConn, err := handler.NewCH(cfg.ClickHouse.Addr, cfg.ClickHouse.Database, cfg.ClickHouse.Username, cfg.ClickHouse.Password)
	if err != nil {
		pool.Close()
		return nil, err
	}

	gin.SetMode(gin.ReleaseMode)
	router, queryJobs := newRouter(cfg, pool, chConn)
	return &App{
		cfg:    cfg,
		pgPool: pool,
		chConn: chConn,
		httpServer: &http.Server{
			Addr:              cfg.Addr,
			Handler:           router,
			ReadHeaderTimeout: 5 * time.Second,
		},
		queryJobs: queryJobs,
	}, nil
}

// Run starts the API and blocks until ctx is canceled or a listener fails.
func (a *App) Run(ctx context.Context) error {
	a.metricsSrv = metrics.Serve(a.cfg.MetricsAddr)
	pgschema.StartRetentionLoop(ctx, a.pgPool, a.cfg.DebugRetentionDays)
	if a.queryJobs != nil {
		a.queryJobs.StartJobWorker(ctx)
	}

	errCh := make(chan error, 1)
	go func() {
		log.Printf("api listening on %s", a.cfg.Addr)
		if err := a.httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case <-ctx.Done():
		return a.Shutdown(context.Background())
	case err := <-errCh:
		_ = a.Shutdown(context.Background())
		return err
	}
}

// Shutdown gracefully closes listeners and connections.
func (a *App) Shutdown(ctx context.Context) error {
	shutdownCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	err := a.httpServer.Shutdown(shutdownCtx)
	metrics.Shutdown(a.metricsSrv)
	if a.chConn != nil {
		_ = a.chConn.Close()
	}
	if a.pgPool != nil {
		a.pgPool.Close()
	}
	return err
}

func newRouter(cfg *config.Config, pool *pgxpool.Pool, chConn driver.Conn) (*gin.Engine, *handler.QueryHandler) {
	r := gin.New()
	r.Use(gin.Recovery(), corsMiddleware(cfg.AllowOrigins), metricsMiddleware())
	r.GET("/healthz", func(c *gin.Context) { c.String(http.StatusOK, "ok") })

	v1 := r.Group("/v1")
	(&handler.ProjectHandler{PG: pool}).Register(v1)
	(&handler.EventDefHandler{PG: pool}).Register(v1)
	(&handler.GovernanceHandler{PG: pool, CH: chConn}).Register(v1)
	analytics := &handler.AnalyticsHandler{PG: pool, CH: chConn}
	analytics.Register(v1)
	queryJobs := &handler.QueryHandler{PG: pool, CH: chConn, Analytics: analytics}
	queryJobs.Register(v1)
	return r, queryJobs
}

func metricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		path := c.FullPath()
		if path == "" {
			path = "unknown"
		}
		status := strconv.Itoa(c.Writer.Status())
		mReqDuration.WithLabelValues(c.Request.Method, path, status).Observe(time.Since(start).Seconds())
		mReqTotal.WithLabelValues(c.Request.Method, path, status).Inc()
	}
}

func corsMiddleware(origins []string) gin.HandlerFunc {
	allowAll := len(origins) == 1 && strings.TrimSpace(origins[0]) == "*"
	allowed := map[string]struct{}{}
	for _, o := range origins {
		allowed[strings.TrimSpace(o)] = struct{}{}
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			if allowAll {
				c.Header("Access-Control-Allow-Origin", origin)
			} else if _, ok := allowed[origin]; ok {
				c.Header("Access-Control-Allow-Origin", origin)
			}
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type,Authorization")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
