# 可观测性（Prometheus + Grafana）

AeroLog 采用 Prometheus 作为指标存储，Grafana 用于可视化与告警。三个 Go 服务（collector、consumer、api）各自暴露一个独立的 `/metrics` 端口，避免与业务端口共用造成鉴权/CORS 复杂度。

## 端口约定

| 服务 | 业务端口 | metrics 端口 | 默认环境变量 |
| --- | --- | --- | --- |
| collector | 8081 | **9101** | `AEROLOG_METRICS_ADDR=:9101` |
| consumer  | （无 HTTP） | **9102** | `AEROLOG_METRICS_ADDR=:9102` |
| api       | 8082 | **9103** | `AEROLOG_METRICS_ADDR=:9103` |

## 启动方式

```bash
# 启动基础设施 + Prometheus + Grafana
docker compose -f deploy/docker-compose.yml up -d

# 在宿主机运行三个 Go 服务（各自占用独立 metrics 端口）
cd server/collector && go run ./cmd &
cd server/consumer  && go run ./cmd &
cd server/api       && go run ./cmd &
```

- Prometheus：<http://localhost:9090>（`up{}` 应能看到三个 service）
- Grafana：<http://localhost:3001>，admin / admin
  - 数据源 `Prometheus` 已通过 provisioning 自动加载
  - 内置面板 `AeroLog / AeroLog Overview`

## 关键指标

### Collector
| 指标 | 类型 | 说明 |
| --- | --- | --- |
| `aerolog_collector_events_received_total{project,result}` | Counter | 接收事件总数（result=accepted/rejected） |
| `aerolog_collector_request_duration_seconds{status}` | Histogram | `/v1/track` 请求耗时分布 |
| `aerolog_collector_kafka_send_errors_total` | Counter | 写 Kafka 失败次数 |

### Consumer
| 指标 | 类型 | 说明 |
| --- | --- | --- |
| `aerolog_consumer_messages_total{result}` | Counter | 消费消息总数（result=ok/invalid） |
| `aerolog_consumer_flush_duration_seconds{result}` | Histogram | 批量写 ClickHouse 耗时 |
| `aerolog_consumer_flush_batch_size` | Histogram | 每次 flush 的批大小 |
| `aerolog_consumer_dlq_total` | Counter | 进入死信队列的消息数 |

### API
| 指标 | 类型 | 说明 |
| --- | --- | --- |
| `aerolog_api_requests_total{method,path,status}` | Counter | 总请求数 |
| `aerolog_api_request_duration_seconds{method,path,status}` | Histogram | 请求耗时分布 |

此外所有服务均自动暴露 Go runtime / process 指标，可用 `go_goroutines`、`process_resident_memory_bytes` 等监控运行健康度。

## 告警建议

- `rate(aerolog_collector_kafka_send_errors_total[5m]) > 0` 持续 3min → 写 Kafka 故障
- `histogram_quantile(0.99, rate(aerolog_collector_request_duration_seconds_bucket[5m])) > 0.5` → 接入层 p99 退化
- `rate(aerolog_consumer_dlq_total[5m]) > 0` → 有事件落 DLQ
- 消费滞后：建议另外接入 [`kminion`](https://github.com/redpanda-data/kminion) 暴露 `kafka_consumer_group_lag` 指标，dashboard 中加面板即可。

## 部署到生产

- 把 `prometheus.yml` 中 `host.docker.internal:910x` 改为 K8s 内部 Service DNS（如 `aerolog-collector.aerolog.svc:9101`）。
- Grafana 的 `admin` 密码必须改为 secret，并启用反向代理鉴权（NGINX、Authentik 等）。
- ClickHouse 写入压力高时建议接入 [`clickhouse-exporter`](https://github.com/ClickHouse/clickhouse_exporter) 监控 merges/replication/parts 等指标。
