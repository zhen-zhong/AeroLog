#!/usr/bin/env bash
set -euo pipefail

# Clean restart for the whole local AeroLog stack.
# Use this when a code update leaves stale Next.js chunks returning 404, or
# when API/collector processes are stuck on their ports.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

stop_port() {
  local port="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  if [[ -n "$pids" ]]; then
    echo "Stopping port $port: $pids"
    kill $pids 2>/dev/null || true
  fi
}

for port in 3000 8081 8082 9101 9102 9103; do
  stop_port "$port"
done

sleep 1

echo "Clearing stale Next.js cache..."
rm -rf "$ROOT/web/.next"

echo "Starting clean AeroLog dev stack..."
exec "$ROOT/scripts/dev.sh"
