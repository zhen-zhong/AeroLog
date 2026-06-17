package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/aerolog/server/api/internal/config"
	"github.com/aerolog/server/api/internal/handler"
	"github.com/aerolog/server/pkg/metrics"
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

func main() {
	cfg := config.FromEnv()

	pool, err := pgxpool.New(context.Background(), cfg.PostgresDSN)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer pool.Close()

	chConn, err := handler.NewCH(cfg.ClickHouse.Addr, cfg.ClickHouse.Database, cfg.ClickHouse.Username, cfg.ClickHouse.Password)
	if err != nil {
		log.Fatalf("clickhouse: %v", err)
	}
	defer chConn.Close()

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery(), corsMiddleware(cfg.AllowOrigins), metricsMiddleware())
	r.GET("/healthz", func(c *gin.Context) { c.String(200, "ok") })

	v1 := r.Group("/v1")
	(&handler.ProjectHandler{PG: pool}).Register(v1)
	(&handler.EventDefHandler{PG: pool}).Register(v1)
	(&handler.AnalyticsHandler{CH: chConn}).Register(v1)

	srv := &http.Server{
		Addr: cfg.Addr, Handler: r, ReadHeaderTimeout: 5 * time.Second,
	}
	metricsSrv := metrics.Serve(cfg.MetricsAddr)
	go func() {
		log.Printf("api listening on %s", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	metrics.Shutdown(metricsSrv)
}

// metricsMiddleware 为 Gin 提供请求计量
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

// corsMiddleware 简易 CORS（管理后台跨域）
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
			c.Header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type,Authorization")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}
