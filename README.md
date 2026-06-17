# AeroLog

> 自研多端埋点平台，参考神策（Sensors Analytics）分层架构。
> SDK 覆盖 Android / iOS / Web，三端共用上报协议；服务端 Go，前后台 Next.js。

## 仓库结构

```
AeroLog/
├── sdk/
│   ├── android/        # Kotlin + Room 离线缓存
│   ├── ios/            # Swift + SQLite 离线缓存
│   └── web/            # TypeScript + IndexedDB 离线缓存
├── server/             # Go 服务端
│   ├── collector/      # 接收层（高并发写 Kafka）
│   ├── consumer/       # Kafka 消费 + ETL
│   ├── api/            # 管理与查询 API
│   └── pkg/            # 公共库
├── web/                # Next.js 前后台（admin + console）
├── deploy/             # docker-compose / k8s
└── docs/               # 协议、架构、部署文档
```

## 整体链路

```
SDK (Android/iOS/Web)
   │  HTTPS POST + gzip + 批量
   ▼
Collector (Go)  ──►  Kafka(events.raw)  ──►  Consumer (Go, ETL)  ──►  ClickHouse
                                                                 │
                                                                 └─►  Postgres (元数据)
                                                                 └─►  MinIO   (原始归档)
```

## 一键启动开发环境

```bash
cd deploy
docker compose up -d
```

启动后包含：PostgreSQL / Redis / Redpanda(Kafka API) / ClickHouse / MinIO。

## 文档

- [Android SDK 接入](sdk/android/README.md)
- [Web SDK 接入](sdk/web/README.md)
- [iOS SDK 接入](sdk/ios/README.md)
- [上报协议](docs/protocol.md)
- [事件 JSON Schema](docs/event.schema.json)
- [架构详解](docs/architecture.md)
