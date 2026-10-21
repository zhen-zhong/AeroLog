#!/usr/bin/env bash
set -euo pipefail

iptables_bin="${IPTABLES_BIN:-/usr/sbin/iptables}"
port="${AEROLOG_MANAGED_KAFKA_PORT:-9092}"
chain="AEROLOG-MANAGED-KAFKA"

: "${AEROLOG_MANAGED_KAFKA_SOURCE_CIDRS:?set approved source CIDRs}"

if ! "$iptables_bin" -nL "$chain" >/dev/null 2>&1; then
  "$iptables_bin" -N "$chain"
fi

"$iptables_bin" -F "$chain"
for cidr in $AEROLOG_MANAGED_KAFKA_SOURCE_CIDRS; do
  "$iptables_bin" -A "$chain" -s "$cidr" -p tcp --dport "$port" -j ACCEPT
done
"$iptables_bin" -A "$chain" -p tcp --dport "$port" -j DROP

if ! "$iptables_bin" -C INPUT -p tcp --dport "$port" -j "$chain" 2>/dev/null; then
  "$iptables_bin" -I INPUT 1 -p tcp --dport "$port" -j "$chain"
fi
