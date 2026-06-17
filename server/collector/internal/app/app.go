// Package app wires the collector service dependencies, router, and lifecycle.
package app

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/aerolog/server/collector/internal/config"
	"github.com/aerolog/server/collector/internal/handler"
	"github.com/aerolog/server/collector/internal/projectcache"
	"github.com/aerolog/server/pkg/metrics"
	"github.com/aerolog/server/pkg/mq"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// App owns the collector service runtime dependencies.
type App struct {
	cfg        *config.Config
	pgPool     *pgxpool.Pool
	producer   *mq.Producer
	httpServer *http.Server
	metricsSrv *http.Server
}

// New builds the collector service without starting listeners.
func New(ctx context.Context, cfg *config.Config) (*App, error) {
	pool, err := pgxpool.New(ctx, cfg.PostgresDSN)
	if err != nil {
		return nil, err
	}

	prod, err := mq.NewProducer(cfg.KafkaBrokers)
	if err != nil {
		pool.Close()
		return nil, err
	}

	gin.SetMode(gin.ReleaseMode)
	router := newRouter(cfg, pool, prod)
	return &App{
		cfg:      cfg,
		pgPool:   pool,
		producer: prod,
		httpServer: &http.Server{
			Addr:              cfg.Addr,
			Handler:           router,
			ReadHeaderTimeout: 5 * time.Second,
		},
	}, nil
}

// Run starts the collector and blocks until ctx is canceled or a listener fails.
func (a *App) Run(ctx context.Context) error {
	a.metricsSrv = metrics.Serve(a.cfg.MetricsAddr)

	errCh := make(chan error, 1)
	go func() {
		log.Printf("collector listening on %s", a.cfg.Addr)
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
	if a.producer != nil {
		_ = a.producer.Close()
	}
	if a.pgPool != nil {
		a.pgPool.Close()
	}
	return err
}

func newRouter(cfg *config.Config, pool *pgxpool.Pool, prod *mq.Producer) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())

	(&handler.TrackHandler{
		Cache:    projectcache.New(pool, 60*time.Second),
		Producer: prod,
		PG:       pool,
		Topic:    cfg.KafkaTopic,
		MaxBody:  cfg.MaxBodyBytes,
	}).Register(r)

	return r
}
