package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"

	"github.com/aerolog/server/api/internal/app"
	"github.com/aerolog/server/api/internal/config"
)

func main() {
	cfg := config.FromEnv()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	application, err := app.New(ctx, cfg)
	if err != nil {
		log.Fatalf("api init: %v", err)
	}
	if err := application.Run(ctx); err != nil && ctx.Err() == nil {
		log.Fatalf("api run: %v", err)
	}
}
