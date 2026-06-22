#!/usr/bin/env bash
set -euo pipefail

# Fix a stale Next.js development server after its .next directory was removed
# or a build update left old chunk URLs in the browser.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3000}"

if command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"
  if [[ -n "$pids" ]]; then
    echo "Stopping stale process on port $PORT: $pids"
    kill $pids 2>/dev/null || true
    sleep 1
  fi
fi

echo "Clearing Next.js development cache..."
rm -rf "$ROOT/web/.next"

echo "Starting AeroLog web on http://127.0.0.1:$PORT"
cd "$ROOT/web"
exec ./node_modules/.bin/next dev -p "$PORT"
