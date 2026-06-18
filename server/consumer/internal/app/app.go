// Package app wires the consumer service dependencies and lifecycle.
package app

import (
	"context"
	"log"
	"net/http"

	"github.com/aerolog/server/consumer/internal/chsink"
	"github.com/aerolog/server/consumer/internal/config"
	"github.com/aerolog/server/consumer/internal/metadata"
	"github.com/aerolog/server/consumer/internal/worker"
	"github.com/aerolog/server/pkg/metrics"
	"github.com/aerolog/server/pkg/pgschema"
	"github.com/jackc/pgx/v5/pgxpool"
)

// App owns the consumer service runtime dependencies.
type App struct {
	cfg        *config.Config
	pgPool     *pgxpool.Pool
	sink       *chsink.Sink
	worker     *worker.Worker
	metricsSrv *http.Server
}

// New builds the consumer service without starting the consumer loop.
func New(ctx context.Context, cfg *config.Config) (*App, error) {
	pool, err := pgxpool.New(ctx, cfg.PostgresDSN)
	if err != nil {
		return nil, err
	}
	if err := pgschema.Ensure(ctx, pool); err != nil {
		pool.Close()
		return nil, err
	}

	sink, err := chsink.New(cfg.ClickHouse.Addr, cfg.ClickHouse.Database,
		cfg.ClickHouse.Username, cfg.ClickHouse.Password)
	if err != nil {
		pool.Close()
		return nil, err
	}

	return &App{
		cfg:    cfg,
		pgPool: pool,
		sink:   sink,
		worker: worker.New(
			cfg.KafkaBrokers,
			cfg.KafkaTopic,
			cfg.GroupID,
			cfg.BatchSize,
			cfg.BatchMs,
			sink,
			metadata.New(pool),
			pool,
		),
	}, nil
}

// Run starts the consumer and blocks until ctx is canceled or the consumer fails.
func (a *App) Run(ctx context.Context) error {
	a.metricsSrv = metrics.Serve(a.cfg.MetricsAddr)
	pgschema.StartRetentionLoop(ctx, a.pgPool, a.cfg.DebugRetentionDays)
	log.Printf("consumer started, brokers=%v topic=%s group=%s", a.cfg.KafkaBrokers, a.cfg.KafkaTopic, a.cfg.GroupID)
	err := a.worker.Run(ctx)
	a.Shutdown()
	if err == context.Canceled {
		return nil
	}
	return err
}

// Shutdown closes runtime dependencies.
func (a *App) Shutdown() {
	metrics.Shutdown(a.metricsSrv)
	if a.sink != nil {
		_ = a.sink.Close()
	}
	if a.pgPool != nil {
		a.pgPool.Close()
	}
}
