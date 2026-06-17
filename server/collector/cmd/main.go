package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/aerolog/server/pkg/metrics"
	"github.com/aerolog/server/pkg/mq"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/aerolog/server/collector/internal/config"
	"github.com/aerolog/server/collector/internal/handler"
	"github.com/aerolog/server/collector/internal/projectcache"
)

func main() {
	cfg := config.FromEnv()

	pool, err := pgxpool.New(context.Background(), cfg.PostgresDSN)
	if err != nil {
		log.Fatalf("postgres connect: %v", err)
	}
	defer pool.Close()

	prod, err := mq.NewProducer(cfg.KafkaBrokers)
	if err != nil {
		log.Fatalf("kafka producer: %v", err)
	}
	defer prod.Close()

	cache := projectcache.New(pool, 60*time.Second)

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	(&handler.TrackHandler{
		Cache:    cache,
		Producer: prod,
		Topic:    cfg.KafkaTopic,
		MaxBody:  cfg.MaxBodyBytes,
	}).Register(r)

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	metricsSrv := metrics.Serve(cfg.MetricsAddr)

	go func() {
		log.Printf("collector listening on %s", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Println("collector shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	metrics.Shutdown(metricsSrv)
}
