# AeroLog 架构详解

## 数据流

```
                     ┌────────────────────────┐
   SDK ─批量+gzip─►  │  Collector (Go, Gin)   │
                     │  鉴权·限流·schema       │
                     └─────────┬──────────────┘
                               │ produce
                               ▼
                     ┌────────────────────────┐
                     │  Kafka topic: events.raw│
                     └─────────┬──────────────┘
                               │ consume
                               ▼
              ┌──────────────────────────────────┐
              │  Consumer (Go) — UA/IP/Schema ETL│
              └──────────┬─────────────┬─────────┘
                         │             │ DLQ
                         ▼             ▼
          ┌────────────────────┐  ┌──────────────────┐
          │  ClickHouse(events)│  │ Postgres(event_dlq)│
          └────────┬───────────┘  └──────────────────┘
                   │ query
                   ▼
              ┌─────────────┐       ┌──────────────────┐
              │ API (Go)    │ <───► │ Postgres (元数据) │
              └──────┬──────┘       └──────────────────┘
                     │
                     ▼
              ┌─────────────────────────┐
              │ Next.js (admin+console) │
              └─────────────────────────┘
```

## 容量演进

- **MVP（单机）**：所有组件 Docker Compose 一台机器，承载 ~1000 QPS / 千万事件/天。
- **中规模**：Collector 水平扩展、Kafka 3 节点、ClickHouse 单副本、Postgres 主从。
- **大规模**：Consumer 按 project 分组消费、ClickHouse 分布式表 + ReplicatedMergeTree、引入 Flink 做实时聚合。

## 关键非功能需求

- **可用性**：Collector 必须无状态；Kafka 短暂不可用时本地 WAL 兜底，恢复后回灌。
- **数据不丢**：SDK 离线持久化 → Collector WAL → Kafka 副本 → Consumer 至少一次 → ClickHouse 幂等去重（`$insert_id`）。
- **可观测**：Collector / Consumer 暴露 `/metrics`（Prometheus），核心指标：QPS、p99、Kafka lag、CH 写入耗时、DLQ 数量。

## 多端 SDK 复用度

- 上报协议、批处理、退避算法、$insert_id 生成等是与平台无关的，三端 SDK 在工程层面保持一致命名（`AeroLog.track / identify / login / logout / setProfile / flush`）。
- 各端独立项目，不共享代码，但共享协议与文档。
