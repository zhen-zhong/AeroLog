// Package app wires the API service dependencies, router, and lifecycle.
package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/aerolog/server/api/internal/config"
	"github.com/aerolog/server/api/internal/docs"
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
	if err := handler.EnsureDefaultAuth(ctx, pool); err != nil {
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
	docs.Register(r)

	v1 := r.Group("/v1", responseEnvelopeMiddleware())
	auth := &handler.AuthHandler{PG: pool}
	auth.RegisterPublic(v1)
	analytics := &handler.AnalyticsHandler{PG: pool, CH: chConn}
	queryJobs := &handler.QueryHandler{PG: pool, CH: chConn, Analytics: analytics}
	queryJobs.RegisterPublic(v1)

	authed := v1.Group("", handler.AuthRequired(pool))
	auth.RegisterPrivate(authed)
	(&handler.ProjectHandler{PG: pool}).Register(authed)

	projectScoped := authed.Group("", handler.ProjectAccessRequired(pool))
	(&handler.EventDefHandler{PG: pool}).Register(projectScoped)
	(&handler.GovernanceHandler{PG: pool, CH: chConn}).Register(projectScoped)
	analytics.Register(projectScoped)
	queryJobs.Register(projectScoped)
	return r, queryJobs
}

type responseEnvelope struct {
	Data    interface{} `json:"data"`
	Message string      `json:"message"`
	Code    int         `json:"code"`
}

type envelopeWriter struct {
	gin.ResponseWriter
	body bytes.Buffer
}

func (w *envelopeWriter) Write(data []byte) (int, error) {
	return w.body.Write(data)
}

func (w *envelopeWriter) WriteString(s string) (int, error) {
	return w.body.WriteString(s)
}

func responseEnvelopeMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.HasSuffix(c.Request.URL.Path, "/download") {
			c.Next()
			return
		}

		writer := &envelopeWriter{ResponseWriter: c.Writer}
		c.Writer = writer
		c.Next()

		status := writer.Status()
		body := bytes.TrimSpace(writer.body.Bytes())
		if len(body) == 0 {
			writer.ResponseWriter.WriteHeader(status)
			return
		}

		contentType := writer.Header().Get("Content-Type")
		if !strings.Contains(contentType, "application/json") {
			writer.ResponseWriter.WriteHeader(status)
			_, _ = writer.ResponseWriter.Write(body)
			return
		}

		payload, err := wrapAPIResponse(status, body)
		if err != nil {
			writer.ResponseWriter.WriteHeader(status)
			_, _ = writer.ResponseWriter.Write(body)
			return
		}

		writer.Header().Del("Content-Length")
		writer.ResponseWriter.WriteHeader(status)
		_, _ = writer.ResponseWriter.Write(payload)
	}
}

func wrapAPIResponse(status int, body []byte) ([]byte, error) {
	var decoded interface{}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return nil, err
	}

	success := status >= http.StatusOK && status < http.StatusBadRequest
	env := responseEnvelope{
		Code:    0,
		Message: "ok",
		Data:    nil,
	}
	if !success {
		env.Code = status
		env.Message = http.StatusText(status)
	}

	if obj, ok := decoded.(map[string]interface{}); ok {
		if data, ok := obj["data"]; ok {
			env.Data = data
		} else if success {
			env.Data = decoded
		}
		if message := responseMessage(obj); message != "" {
			env.Message = message
		}
		if code := responseCode(obj); code != nil {
			env.Code = *code
		}
	} else if success {
		env.Data = decoded
	}

	return json.Marshal(env)
}

func responseMessage(obj map[string]interface{}) string {
	for _, key := range []string{"message", "err", "error", "msg"} {
		if value, ok := obj[key].(string); ok && strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func responseCode(obj map[string]interface{}) *int {
	value, ok := obj["code"]
	if !ok {
		return nil
	}
	var code int
	switch v := value.(type) {
	case float64:
		code = int(v)
	case int:
		code = v
	default:
		return nil
	}
	return &code
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
