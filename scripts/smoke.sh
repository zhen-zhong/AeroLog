#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8082}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@aerolog.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-aerolog123}"

echo "checking API health..."
curl -fsS "$API_BASE/healthz"
echo

echo "logging in..."
TOKEN="$(curl -fsS "$API_BASE/v1/auth/login" \
  -H 'Content-Type: application/json' \
  --data "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).data.token))')"

echo "checking project list..."
curl -fsS "$API_BASE/v1/projects" -H "Authorization: Bearer $TOKEN"
echo
