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
| `AEROLOG_INPUT_FORMAT` | `aerolog`；神策使用 `sensors_flatten_json` |
| `AEROLOG_SENSORS_TARGET_PROJECT_ID` | 神策导入时必填，目标 AeroLog 项目 ID |
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

## 神策 Kafka 导入

神策 `FLATTEN_JSON` 事件不能与 SDK 原始 topic 混用。生产编排提供独立的 `sensors-consumer`，将 `event`、`distinct_id`、`time`、`identities`、`properties` 映射为 AeroLog 事件，并把神策来源元数据保存在事件属性中。

先在 AeroLog 创建目标项目，并在服务器私有 `.env` 设置：

```bash
AEROLOG_SENSORS_EVENTS_TOPIC=<sensors-events-topic>
AEROLOG_SENSORS_TARGET_PROJECT_ID=<aerolog-project-id>
```

随后显式启动：

```bash
docker compose --profile sensorsdata up -d --build sensors-consumer
```

该消费者使用独立 group，不影响 SDK `events.raw` 消费链路。
