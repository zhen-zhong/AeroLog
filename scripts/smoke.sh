#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8082}"

echo "checking API health..."
curl -fsS "$API_BASE/healthz"
echo

echo "checking project list..."
curl -fsS "$API_BASE/v1/projects"
echo
