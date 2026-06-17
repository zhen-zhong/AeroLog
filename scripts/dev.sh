#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/.run/logs"
PID_DIR="$ROOT/.run/pids"

mkdir -p "$LOG_DIR" "$PID_DIR"

cleanup() {
  local code=$?
  for pid_file in "$PID_DIR"/*.pid; do
    [[ -f "$pid_file" ]] || continue
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  exit "$code"
}
trap cleanup INT TERM EXIT

start_service() {
  local name="$1"
  local dir="$2"
  shift 2
  echo "starting $name..."
  (
    cd "$ROOT/$dir"
    "$@"
  ) >"$LOG_DIR/$name.log" 2>&1 &
  echo "$!" >"$PID_DIR/$name.pid"
}

wait_http() {
  local name="$1"
  local url="$2"
  local limit="${3:-45}"
  for _ in $(seq 1 "$limit"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name is ready: $url"
      return 0
    fi
    sleep 1
  done
  echo "$name failed to become ready: $url"
  echo "last logs:"
  tail -n 80 "$LOG_DIR/$name.log" || true
  return 1
}

if [[ "${SKIP_INFRA:-0}" != "1" ]]; then
  echo "starting docker compose infra..."
  docker compose -f "$ROOT/deploy/docker-compose.yml" up -d
fi

start_service api server/api go run ./cmd
start_service collector server/collector go run ./cmd
start_service consumer server/consumer go run ./cmd
start_service web web npm run dev

wait_http api "http://127.0.0.1:8082/healthz"
wait_http collector "http://127.0.0.1:8081/healthz"
wait_http web "http://127.0.0.1:3000"

echo
echo "AeroLog is running:"
echo "  web:       http://127.0.0.1:3000"
echo "  api:       http://127.0.0.1:8082"
echo "  collector: http://127.0.0.1:8081"
echo "  logs:      $LOG_DIR"
echo
echo "press Ctrl+C to stop all foreground services"

while true; do
  sleep 3600
done
