#!/usr/bin/env sh
set -eu

: "${AEROLOG_SENSORS_KAFKA_SOURCE_CIDR:?set the approved source CIDR}"

iptables_bin="${IPTABLES_BIN:-/usr/sbin/iptables}"
chain="DOCKER-USER"
container_port="${AEROLOG_KAFKA_CONTAINER_PORT:-19092}"

# Docker applies DNAT before DOCKER-USER, so this rule deliberately targets
# Redpanda's container port rather than the host port 9092.
if ! "$iptables_bin" -w -C "$chain" -p tcp -s "$AEROLOG_SENSORS_KAFKA_SOURCE_CIDR" --dport "$container_port" -j ACCEPT 2>/dev/null; then
  "$iptables_bin" -w -I "$chain" 1 -p tcp -s "$AEROLOG_SENSORS_KAFKA_SOURCE_CIDR" --dport "$container_port" -j ACCEPT
fi

if ! "$iptables_bin" -w -C "$chain" -p tcp --dport "$container_port" -j DROP 2>/dev/null; then
  "$iptables_bin" -w -I "$chain" 2 -p tcp --dport "$container_port" -j DROP
fi
