# Collector

AeroLog 接收层。无状态高并发 HTTP 服务，将 SDK 上报的事件鉴权后写入 Kafka。

## 启动

```bash
# 1. 启动依赖
cd ../../deploy && docker compose up -d

# 2. 创建 Kafka topic（若 Redpanda 未自动创建）
docker exec aerolog-redpanda rpk topic create events.raw -p 6 -r 1

# 3. 在 Postgres 中插一个项目，拿到 token
docker exec -it aerolog-postgres psql -U aerolog -d aerolog -c \
  "INSERT INTO projects(name, token, secret) VALUES ('demo', 'demo_token', 'demo_secret');"

# 4. 启动 Collector
cd ../server/collector
go mod tidy
go run ./cmd
```

## 自测

```bash
curl -XPOST 'http://localhost:8081/v1/track?token=demo_token' \
  -H 'Content-Type: application/json' \
  -d '[{
    "type":"track",
    "event":"hello",
    "distinct_id":"u1",
    "time": 1718432000000,
    "lib":{"name":"web","version":"0.1.0"},
    "properties":{"a":1}
  }]'
```

到 Redpanda Console（http://localhost:8088 ）的 `events.raw` topic 应能看到这条消息。

## 环境变量

| 变量 | 默认 |
|---|---|
| `AEROLOG_ADDR` | `:8081` |
| `AEROLOG_KAFKA_BROKERS` | `localhost:19092` |
| `AEROLOG_KAFKA_TOPIC` | `events.raw` |
| `AEROLOG_PG_DSN` | `postgres://aerolog:aerolog@localhost:5432/aerolog?sslmode=disable` |
| `AEROLOG_REDIS_ADDR` | `localhost:6379` |
