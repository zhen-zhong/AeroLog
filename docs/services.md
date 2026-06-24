# AeroLog 运行时服务说明

本文从**容器视角**梳理 AeroLog 在生产环境（`/opt/aerolog/deploy/production/docker-compose.yml`）启动的全部 12 个容器及其角色、依赖、排查路径。

> 与 [`architecture.md`](./architecture.md) 互补：`architecture.md` 描述设计架构与模块边界；本文聚焦"线上跑着的具体容器是什么、出问题去哪看"。

## 1. 服务拓扑总览

```
              ┌─────────────────────┐
   外部用户 ──→│  Nginx :80 (公网)   │
              └──────────┬──────────┘
                         │
        ┌────────────────┼─────────────────┬──────────────┐
        ▼                ▼                 ▼              ▼
       Web              API             Collector    Grafana / Console
      (页面)          (业务接口)       (埋点接收)    (运维面板)
                       │                    │
                       │ 读写               │ 投递
                       ▼                    ▼
        ┌──────┐  ┌──────┐  ┌──────┐    ┌──────────┐
        │ PG   │  │Redis │  │  CH  │    │ Redpanda │
        │元数据│  │ 缓存 │  │ 事件 │    │ 消息队列  │
        └──────┘  └──────┘  └──────┘    └────┬─────┘
                                ▲             │ 消费
                                │             │
                                └─── Consumer ┘
                                 (读队列写CH)

       Prometheus ──抓指标── (api / collector / consumer)
            └── 数据源 → Grafana
```

## 2. 容器一览

按数据流方向 + 重要程度分组。

### 2.1 入口层（暴露公网）

| 容器 | 镜像 | 角色 | 端口 |
|---|---|---|---|
| **aerolog-nginx-1** | `nginx:1.27-alpine` | 唯一对外入口，反向代理 + Basic Auth | `80:80` ✅ |

`nginx.conf` 路径分流：

| 前缀 | 转发到 | 备注 |
|---|---|---|
| `/` | `aerolog-web-1` | Next.js 控制台 |
| `/api/v1/*` | `aerolog-api-1` | 业务 API |
| `/collect/v1/*` | `aerolog-collector-1` | SDK 埋点入口 |
| `/queue/*` | `aerolog-redpanda-console-1` | 加 Basic Auth |
| `/monitor/*` | `aerolog-grafana-1` | 加 Basic Auth |

> ⚠️ 不要直接对外开放 `3000`（Grafana）、`9092`/`9644`/`8088`（Redpanda 原生）这些端口；统一从 Nginx 走。

### 2.2 应用层

| 容器 | 语言 | 作用 | Nginx 路径 |
|---|---|---|---|
| **aerolog-web-1** | Next.js | 控制台 + 营销落地页 | `/` |
| **aerolog-api-1** | Go | 登录、项目、分析查询 | `/api/v1/*` |
| **aerolog-collector-1** | Go | SDK 埋点接收，投递到 Redpanda | `/collect/v1/*` |
| **aerolog-consumer-1** | Go | 消费 Redpanda 写入 ClickHouse | 无（后台） |

源码位置：`server/api`、`server/collector`、`server/consumer`、`web/`。

### 2.3 数据层

| 容器 | 类型 | 存什么 |
|---|---|---|
| **aerolog-postgres-1** | 关系型数据库 | 用户、项目、权限、漏斗/留存定义等元数据 |
| **aerolog-clickhouse-1** | 列式分析数据库 | 事件明细（用户行为日志），聚合查询主战场 |
| **aerolog-redis-1** | 内存 KV 缓存 | 会话、限流计数、临时缓存 |

> 三者分工：**PG 管"业务实体"，CH 管"事件流水"，Redis 管"临时状态"**——分析平台标准三件套。

持久化目录：

```
/opt/aerolog/deploy/production/data/{postgres,redis,clickhouse}
```

### 2.4 消息队列层

| 容器 | 角色 | 暴露 |
|---|---|---|
| **aerolog-redpanda-1** | Kafka 兼容消息队列 | 内网 `9092`，不暴露 |
| **aerolog-redpanda-console-1** | Topic / 消费组可视化面板 | 通过 `/queue/`（Basic Auth） |

**为什么用消息队列？** Collector 拿到 SDK 上报后**不直接写库**，而是丢进 Redpanda：

- 突发流量不会打爆 ClickHouse
- Consumer 可以批量消费，写入更高效
- Consumer 挂了消息不会丢，重启继续消费

### 2.5 监控层

| 容器 | 角色 | 暴露 |
|---|---|---|
| **aerolog-prometheus-1** | 时序数据库，每 15 s 抓 api/collector/consumer 指标，保留 7 天 | 内网 `9090` |
| **aerolog-grafana-1** | 监控仪表盘，把 Prometheus 数据画图 | `/monitor/`（Basic Auth） |

> 监控层看的是**系统指标**（QPS、错误率、内存、延迟），不是用户行为；用户行为分析在 Web 控制台。

## 3. 启动依赖与顺序

`docker-compose.yml` 的 `depends_on + healthcheck` 保证启动顺序：

```
postgres / redis / clickhouse / redpanda  (基础设施，需 healthy)
        ↓
api / collector / consumer / redpanda-console / web  (应用层)
        ↓
nginx                                      (入口层)
        ↓
prometheus / grafana                       (监控层，可独立)
```

整体冷启 ≈ 30–60 秒（取决于 ClickHouse 与 Redpanda 健康检查通过的速度）。

## 4. 资源占用经验值

```bash
sudo docker stats --no-stream
```

| 容器 | 经验占用 | 备注 |
|---|---|---|
| clickhouse | 600MB – 1GB | 最大单户，事件量增加会涨 |
| redpanda | 500MB – 1GB | 默认配置较吃内存 |
| postgres | 50MB – 200MB | 元数据量小 |
| prometheus | 200MB – 400MB | 7 天保留 |
| grafana | 100MB – 200MB | |
| api / collector / consumer | 30MB – 100MB / 个 | Go 服务低开销 |
| web | 100MB – 200MB | Next.js 生产模式 |
| nginx / redis | 10MB – 50MB | 几乎可忽略 |

合计约 **1.6 – 2.5 GiB**，3.6 GiB 机器尚有余量但不充裕。要省内存先动 ClickHouse 与 Redpanda 的资源限制。

## 5. 排查路径速查表

| 现象 | 优先查看的容器日志 |
|---|---|
| 网站 502 / 打不开 | `nginx`、`web` |
| 登录失败 / 接口 500 | `api`、`postgres` |
| 埋点没入库 | `collector` → `redpanda` → `consumer` |
| 分析查询慢 / 报错 | `api`、`clickhouse` |
| 消息积压 | `/queue/` 看 Topic 与 Consumer Group |
| 接口慢但不报错 | `grafana` 看 P95 / 错误率面板 |
| 监控面板没数据 | `prometheus` Targets，再查 `api/collector/consumer` 是否暴露 `/metrics` |

通用日志命令：

```bash
cd /opt/aerolog/deploy/production
sudo docker compose logs -f <服务名> --tail=100
```

## 6. 常用运维命令

```bash
# 查看全部容器状态
sudo docker compose ps

# 查看资源占用
sudo docker stats --no-stream

# 重启单个服务
sudo docker compose restart api

# 重建变更后的镜像（git pull 后必做）
sudo docker compose build
sudo docker compose up -d

# 健康检查三连
curl -I http://127.0.0.1/
curl http://127.0.0.1/api/healthz
curl -I http://127.0.0.1/queue/      # 期望 401（未认证）
```

## 7. 端口与网络

> 详见 [`production-deployment.md`](./production-deployment.md) §1–§2。

- 唯一对外端口：`80`（Nginx）
- 内网容器互相通过 Docker 网络 `aerolog-net` 用容器名互访（如 `postgres:5432`、`redpanda:9092`）
- Prometheus / Grafana / 数据库等**不**在公网暴露，仅 `127.0.0.1` 本地可访问

## 8. 与 SDK 的对接关系

SDK 默认上报到 SaaS 官方入口 `https://collector.aerolog.cc`；接入本部署需在 SDK 初始化时显式覆盖 `serverUrl` 为 `http://82.156.142.135/collect`（未上 HTTPS 前）。

请求路径：`${serverUrl}/v1/track?token=...` → Nginx `/collect/v1/*` → `aerolog-collector-1`。

详见 [`production-deployment.md`](./production-deployment.md) §2.1。

## 9. 相关文档

- [`architecture.md`](./architecture.md) — 设计架构与模块边界
- [`production-deployment.md`](./production-deployment.md) — 生产部署与维护手册
- [`observability.md`](./observability.md) — 监控指标设计
- [`protocol.md`](./protocol.md) — SDK 上报协议
