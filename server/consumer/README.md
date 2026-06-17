# Consumer

消费 Kafka `events.raw` topic，做 UA/IP 富化与 schema 校验后批量写入 ClickHouse。失败事件落 Postgres `event_dlq`。

## 启动

```bash
cd server/consumer
go mod tidy
go run ./cmd
```

## 环境变量

| 变量 | 默认 |
|---|---|
| `AEROLOG_KAFKA_BROKERS` | `localhost:19092` |
| `AEROLOG_KAFKA_TOPIC` | `events.raw` |
| `AEROLOG_GROUP_ID` | `aerolog-consumer` |
| `AEROLOG_CH_ADDR` | `localhost:9000` |
| `AEROLOG_CH_DB` | `aerolog` |
| `AEROLOG_CH_USER` | `aerolog` |
| `AEROLOG_CH_PASSWORD` | `aerolog` |
| `AEROLOG_PG_DSN` | `postgres://aerolog:aerolog@localhost:5432/aerolog?sslmode=disable` |

## 验证

```bash
# 查 CH
docker exec -it aerolog-clickhouse clickhouse-client \
  --user aerolog --password aerolog -d aerolog \
  --query "SELECT event, count() FROM events GROUP BY event"
```
