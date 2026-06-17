package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/aerolog/server/pkg/metrics"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/aerolog/server/consumer/internal/chsink"
	"github.com/aerolog/server/consumer/internal/config"
	"github.com/aerolog/server/consumer/internal/metadata"
	"github.com/aerolog/server/consumer/internal/worker"
)

func main() {
	cfg := config.FromEnv()

	pool, err := pgxpool.New(context.Background(), cfg.PostgresDSN)
	if err != nil {
		log.Fatalf("postgres connect: %v", err)
	}
	defer pool.Close()

	sink, err := chsink.New(cfg.ClickHouse.Addr, cfg.ClickHouse.Database,
		cfg.ClickHouse.Username, cfg.ClickHouse.Password)
	if err != nil {
		log.Fatalf("clickhouse connect: %v", err)
	}
	defer sink.Close()

	w := worker.New(cfg.KafkaBrokers, cfg.KafkaTopic, cfg.GroupID, cfg.BatchSize, cfg.BatchMs, sink, metadata.New(pool), pool)

	metricsSrv := metrics.Serve(cfg.MetricsAddr)
	defer metrics.Shutdown(metricsSrv)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
		<-stop
		log.Println("consumer shutting down...")
		cancel()
	}()

	log.Printf("consumer started, brokers=%v topic=%s group=%s", cfg.KafkaBrokers, cfg.KafkaTopic, cfg.GroupID)
	if err := w.Run(ctx); err != nil && err != context.Canceled {
		log.Fatalf("run: %v", err)
	}
}
