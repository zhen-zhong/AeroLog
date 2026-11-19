#!/usr/bin/env bash

set -Eeuo pipefail

umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
COMPOSE_DIR=$(cd -- "${SCRIPT_DIR}/.." && pwd)
BACKUP_ROOT=${AEROLOG_BACKUP_ROOT:-/var/backups/aerolog}
ENV_FILE=${AEROLOG_ENV_FILE:-${COMPOSE_DIR}/.env}
STAMP=${AEROLOG_BACKUP_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}
BACKUP_DIR=${BACKUP_ROOT}/${STAMP}
PARTIAL_DIR=${BACKUP_ROOT}/.partial-${STAMP}
CLICKHOUSE_BACKUP_NAME=${STAMP}.zip
CLICKHOUSE_CONTAINER_PATH=/var/lib/clickhouse/backups/${CLICKHOUSE_BACKUP_NAME}
RPK_IMAGE=${AEROLOG_RPK_IMAGE:-redpandadata/redpanda:v24.3.5}
KAFKA_NETWORK=${AEROLOG_KAFKA_NETWORK:-aerolog_kafka-ingress}

if [[ ! ${STAMP} =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo "AEROLOG_BACKUP_STAMP 格式必须为 YYYYMMDDTHHMMSSZ" >&2
  exit 2
fi

if [[ -e ${BACKUP_DIR} || -e ${PARTIAL_DIR} ]]; then
  echo "备份目录已存在：${BACKUP_DIR}" >&2
  exit 2
fi

mkdir -p -- "${BACKUP_ROOT}"

FREE_KB=$(df -Pk -- "${BACKUP_ROOT}" | awk 'NR == 2 {print $4}')
MIN_FREE_KB=${AEROLOG_BACKUP_MIN_FREE_KB:-5242880}
if (( FREE_KB < MIN_FREE_KB )); then
  echo "可用空间不足：至少需要 $((MIN_FREE_KB / 1024)) MiB" >&2
  exit 1
fi

mkdir -- "${PARTIAL_DIR}"

cleanup() {
  docker compose -f "${COMPOSE_DIR}/docker-compose.yml" exec -T --user root clickhouse \
    rm -f -- "${CLICKHOUSE_CONTAINER_PATH}" >/dev/null 2>&1 || true
  if [[ -d ${PARTIAL_DIR} ]]; then
    rm -rf -- "${PARTIAL_DIR}"
  fi
}
trap cleanup EXIT

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
  docker run --rm --network "${KAFKA_NETWORK}" "${RPK_IMAGE}" "$@" -X "brokers=${brokers}"
}

echo "[1/4] 备份 PostgreSQL"
compose exec -T postgres pg_dump -U aerolog -d aerolog \
  --format=custom --compress=6 --no-owner --no-privileges > "${PARTIAL_DIR}/postgres.dump"

compose exec -T postgres psql -U aerolog -d aerolog -At \
  -c "SELECT schemaname || E'\\t' || tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename" |
while IFS=$'\t' read -r schema table; do
  count=$(compose exec -T postgres psql -U aerolog -d aerolog -At \
    -c "SELECT count(*) FROM \"${schema}\".\"${table}\"")
  printf '%s\t%s\t%s\n' "${schema}" "${table}" "${count}"
done > "${PARTIAL_DIR}/postgres-counts.tsv"

echo "[2/4] 备份 ClickHouse"
compose exec -T --user root clickhouse install -d -o clickhouse -g clickhouse \
  /var/lib/clickhouse/backups
clickhouse --query "BACKUP DATABASE aerolog TO File('${CLICKHOUSE_CONTAINER_PATH}')"
compose exec -T clickhouse cat "${CLICKHOUSE_CONTAINER_PATH}" > "${PARTIAL_DIR}/clickhouse.zip"

clickhouse --query \
  "SELECT name FROM system.tables WHERE database = 'aerolog' AND is_temporary = 0 ORDER BY name FORMAT TSVRaw" |
while IFS= read -r table; do
  count=$(clickhouse --query "SELECT count() FROM aerolog.\`${table}\` FORMAT TSVRaw")
  printf '%s\t%s\n' "${table}" "${count}"
done > "${PARTIAL_DIR}/clickhouse-counts.tsv"

echo "[3/4] 导出 Kafka 消费组 offset"
mkdir "${PARTIAL_DIR}/kafka-offsets"
KAFKA_BROKERS=$(read_env_value AEROLOG_KAFKA_BROKERS)
if [[ -n ${KAFKA_BROKERS} ]]; then
  rpk "${KAFKA_BROKERS}" group list > "${PARTIAL_DIR}/kafka-groups.txt"
  awk 'NR > 1 && $2 ~ /^aerolog-/ {print $2}' "${PARTIAL_DIR}/kafka-groups.txt" |
  while IFS= read -r group; do
    [[ -n ${group} ]] || continue
    safe_group=${group//[^a-zA-Z0-9._-]/_}
    rpk "${KAFKA_BROKERS}" group describe -c "${group}" |
      awk 'NR > 1 && $1 != "" {print $1, $2, $3}' \
      > "${PARTIAL_DIR}/kafka-offsets/${safe_group}.txt"
  done
else
  printf '%s\n' 'AEROLOG_KAFKA_BROKERS 未配置，未导出外部 Kafka offset。' \
    > "${PARTIAL_DIR}/kafka-groups.txt"
fi

echo "[4/4] 生成校验信息"
{
  printf 'backup_id=%s\n' "${STAMP}"
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'postgres_version=%s\n' "$(compose exec -T postgres pg_dump --version | tr -d '\r')"
  printf 'clickhouse_version=%s\n' "$(clickhouse --version | tr -d '\r')"
} > "${PARTIAL_DIR}/manifest.txt"

(
  cd "${PARTIAL_DIR}"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)

mv -- "${PARTIAL_DIR}" "${BACKUP_DIR}"
trap - EXIT
compose exec -T --user root clickhouse rm -f -- "${CLICKHOUSE_CONTAINER_PATH}"

echo "备份完成：${BACKUP_DIR}"
