#!/usr/bin/env bash

set -Eeuo pipefail

umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
COMPOSE_DIR=$(cd -- "${SCRIPT_DIR}/.." && pwd)
BACKUP_ROOT=${AEROLOG_BACKUP_ROOT:-/var/backups/aerolog}
ENV_FILE=${AEROLOG_ENV_FILE:-${COMPOSE_DIR}/.env}
BACKUP_ID=${1:-latest}
RPK_IMAGE=${AEROLOG_RPK_IMAGE:-redpandadata/redpanda:v24.3.5}
KAFKA_NETWORK=${AEROLOG_KAFKA_NETWORK:-aerolog_kafka-ingress}

if [[ ${BACKUP_ID} == latest ]]; then
  BACKUP_ID=$(find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d \
    -name '20??????T??????Z' -printf '%f\n' | sort | tail -n 1)
fi

if [[ ! ${BACKUP_ID} =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo "备份 ID 格式必须为 YYYYMMDDTHHMMSSZ" >&2
  exit 2
fi

BACKUP_DIR=${BACKUP_ROOT}/${BACKUP_ID}
if [[ ! -d ${BACKUP_DIR} ]]; then
  echo "备份不存在：${BACKUP_DIR}" >&2
  exit 2
fi

DRILL_SUFFIX=${BACKUP_ID//[TZ]/}
DRILL_SUFFIX=${DRILL_SUFFIX//:/}
PG_DRILL_DB=aerolog_drill_${DRILL_SUFFIX}
CH_DRILL_DB=aerolog_drill_${DRILL_SUFFIX}
CH_RESTORE_NAME=restore-${BACKUP_ID}.zip
CH_RESTORE_PATH=/var/lib/clickhouse/backups/${CH_RESTORE_NAME}
KAFKA_TOPIC=aerolog.recovery.drill.${DRILL_SUFFIX,,}
KAFKA_GROUP=aerolog-recovery-drill-${DRILL_SUFFIX,,}

compose() {
  docker compose -f "${COMPOSE_DIR}/docker-compose.yml" "$@"
}

clickhouse() {
  compose exec -T clickhouse sh -lc \
    'clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" "$@"' \
    clickhouse-client "$@"
}

read_env_value() {
  local key=$1
  sed -n "s/^${key}=//p" "${ENV_FILE}" | tail -n 1
}

rpk() {
  local brokers=$1
  shift
  docker run --rm -i --network "${KAFKA_NETWORK}" "${RPK_IMAGE}" "$@" -X "brokers=${brokers}"
}

cleanup() {
  compose exec -T postgres psql -U aerolog -d postgres -v ON_ERROR_STOP=1 \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PG_DRILL_DB}' AND pid <> pg_backend_pid()" \
    >/dev/null 2>&1 || true
  compose exec -T postgres dropdb -U aerolog --if-exists "${PG_DRILL_DB}" >/dev/null 2>&1 || true
  clickhouse --query "DROP DATABASE IF EXISTS ${CH_DRILL_DB}" >/dev/null 2>&1 || true
  compose exec -T --user root clickhouse rm -f -- "${CH_RESTORE_PATH}" >/dev/null 2>&1 || true
  if [[ -n ${KAFKA_BROKERS:-} ]]; then
    rpk "${KAFKA_BROKERS}" group delete "${KAFKA_GROUP}" >/dev/null 2>&1 || true
    rpk "${KAFKA_BROKERS}" topic delete "${KAFKA_TOPIC}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "[1/5] 校验备份文件"
(
  cd "${BACKUP_DIR}"
  sha256sum --check SHA256SUMS
)

echo "[2/5] 恢复 PostgreSQL 到临时数据库"
compose exec -T postgres createdb -U aerolog "${PG_DRILL_DB}"
compose exec -T postgres pg_restore -U aerolog -d "${PG_DRILL_DB}" \
  --no-owner --no-privileges --exit-on-error < "${BACKUP_DIR}/postgres.dump"

while IFS=$'\t' read -r schema table expected; do
  actual=$(compose exec -T postgres psql -U aerolog -d "${PG_DRILL_DB}" -At \
    -c "SELECT count(*) FROM \"${schema}\".\"${table}\"")
  if [[ ${actual} != "${expected}" ]]; then
    echo "PostgreSQL 行数不一致：${schema}.${table}，备份=${expected}，恢复=${actual}" >&2
    exit 1
  fi
done < "${BACKUP_DIR}/postgres-counts.tsv"

echo "[3/5] 恢复 ClickHouse 到临时数据库"
compose exec -T --user root clickhouse install -d -o clickhouse -g clickhouse \
  /var/lib/clickhouse/backups
compose exec -T clickhouse sh -c "cat > '${CH_RESTORE_PATH}'" < "${BACKUP_DIR}/clickhouse.zip"
clickhouse --query \
  "RESTORE DATABASE aerolog AS ${CH_DRILL_DB} FROM File('${CH_RESTORE_PATH}')"

while IFS=$'\t' read -r table expected; do
  actual=$(clickhouse --query "SELECT count() FROM ${CH_DRILL_DB}.\`${table}\` FORMAT TSVRaw")
  if [[ ${actual} != "${expected}" ]]; then
    echo "ClickHouse 行数不一致：${table}，备份=${expected}，恢复=${actual}" >&2
    exit 1
  fi
done < "${BACKUP_DIR}/clickhouse-counts.tsv"

echo "[4/5] 验证 Kafka 独立 Topic 与 offset 回放"
KAFKA_BROKERS=$(read_env_value AEROLOG_KAFKA_BROKERS)
if [[ -z ${KAFKA_BROKERS} ]]; then
  echo "AEROLOG_KAFKA_BROKERS 未配置，无法执行 Kafka offset 回放" >&2
  exit 1
fi

rpk "${KAFKA_BROKERS}" topic create "${KAFKA_TOPIC}" --partitions 1 --replicas 1 >/dev/null
printf 'marker-1\nmarker-2\nmarker-3\n' |
  rpk "${KAFKA_BROKERS}" topic produce "${KAFKA_TOPIC}" -f '%v\n' >/dev/null

FIRST_READ=$(mktemp)
SECOND_READ=$(mktemp)
trap 'rm -f -- "${FIRST_READ:-}" "${SECOND_READ:-}"; cleanup' EXIT
rpk "${KAFKA_BROKERS}" topic consume "${KAFKA_TOPIC}" -g "${KAFKA_GROUP}" -n 3 -f '%v\n' \
  > "${FIRST_READ}"
rpk "${KAFKA_BROKERS}" group seek "${KAFKA_GROUP}" --to start --topics "${KAFKA_TOPIC}" >/dev/null
rpk "${KAFKA_BROKERS}" topic consume "${KAFKA_TOPIC}" -g "${KAFKA_GROUP}" -n 3 -f '%v\n' \
  > "${SECOND_READ}"

if ! cmp -s "${FIRST_READ}" "${SECOND_READ}"; then
  echo "Kafka offset 回放结果不一致" >&2
  exit 1
fi
rm -f -- "${FIRST_READ}" "${SECOND_READ}"

echo "[5/5] 清理临时数据库和测试 Topic"
cleanup
trap - EXIT

echo "恢复演练通过：${BACKUP_ID}"
