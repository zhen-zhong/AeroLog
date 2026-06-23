SHELL := /bin/bash

.PHONY: dev infra api collector consumer web restart-web restart-dev-clean analytics-smoke android-sdk-build test smoke p1-smoke

dev:
	./scripts/dev.sh

infra:
	docker compose -f deploy/docker-compose.yml up -d

api:
	cd server/api && go run ./cmd

collector:
	cd server/collector && go run ./cmd

consumer:
	cd server/consumer && go run ./cmd

web:
	cd web && npm run dev

restart-web:
	./scripts/restart-web.sh

restart-dev-clean:
	./scripts/restart-dev-clean.sh

android-sdk-build:
	./scripts/android-sdk-build.sh

test:
	cd server/api && GOCACHE=/private/tmp/aerolog-go-cache go test ./...
	cd server/collector && GOCACHE=/private/tmp/aerolog-go-cache go test ./...
	cd server/consumer && GOCACHE=/private/tmp/aerolog-go-cache go test ./...
	cd server/pkg && GOCACHE=/private/tmp/aerolog-go-cache go test ./...
	cd web && npm run build

smoke:
	./scripts/smoke.sh

analytics-smoke:
	node scripts/analytics-smoke.mjs

p1-smoke:
	node scripts/p1-smoke.mjs

seed:
	node scripts/seed-data.mjs
