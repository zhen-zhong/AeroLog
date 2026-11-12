# AeroLog 运行时服务说明

本文说明生产编排 [`deploy/production/docker-compose.yml`](../deploy/production/docker-compose.yml) 中的服务、数据链路与排查方式。

当前 Compose 定义 **16 个服务**；神策消费者通过 `sensorsdata` profile 启动。公网登录代理 `aerolog-login-proxy` 独立运行，配置见 [`deploy/production/nginx.login-proxy.conf`](../deploy/production/nginx.login-proxy.conf)，不属于 Compose。

## 1. 总体链路

```text
自研 SDK ──► Collector ──► Redpanda ──► Consumer ───────► ClickHouse
                                               │
神策 Kafka ─────────────────────────► Sensors Consumer ──┤
神策用户属性 Kafka ────────────────► Profile Consumer ───┤
                                               │
浏览器 ──► 登录代理 ──► Web / API ────────────────┬─────┘
                                                   ▼
                              PostgreSQL（项目、权限、配置、定义）

企业微信 AI 机器人 ──► 固定只读 Skill ──► API / Prometheus / Host Inspector
Prometheus ◄── API / Collector / Consumer / Node Exporter ──► Grafana
```

两类数据源均进入 ClickHouse，但神策记录带 `$aerolog_source=sensorsdata`、神策项目标识与接入覆盖时间；分析、对账和权限均以 AeroLog 项目为边界。

## 2. 服务一览

### 2.1 应用与接入

| 服务 | 角色 | 网络 / 入口 |
|---|---|---|
| `web` | Next.js 控制台、项目管理、分析页面 | 仅 `internal`；由登录代理转发 `/` |
| `api` | Go API：认证、项目、分析、神策配置、对账、企业微信内部查询 | `internal` + `api-egress`；由登录代理转发 `/api/` |
| `collector` | 自研 SDK 接收、鉴权、限流、写入 Redpanda | `internal` + `kafka-ingress`；由登录代理转发 `/collect/` |
| `consumer` | 消费自研埋点，ETL 后写入 ClickHouse | 后台服务 |
| `sensors-consumer` | 消费神策事件 `FLATTEN_JSON`，映射后写入 ClickHouse | `sensorsdata` profile；后台服务 |
| `sensors-profile-consumer` | 消费神策用户属性，按源项目路由与 UPSERT | `sensorsdata` profile；后台服务 |

神策消费者不会消费自研 SDK 的 `events.raw`；路由依据神策 `project_id` 与已启用的 `sensors_integrations` 映射。解析或写入失败进入 DLQ，成功写入后才提交 Kafka offset。

### 2.2 机器人与宿主机巡检

| 服务 | 角色 | 权限边界 |
|---|---|---|
| `wecom-aibot` | 企业微信智能机器人长连接。广告等分析问题由 AI 规划固定 Skill；确定的运维问题直接走规则与固定格式。 | 仅可访问 API 与 AI 服务；密钥仅来自 `.env` |
| `host-inspector` | 返回白名单目录的占用聚合，供 `directory_usage` Skill 使用。 | 只读挂载宿主机根目录、`cap_drop: ALL`、无 Docker Socket、仅 `internal` |

当前可用 Skill：`ads_summary`、`server_status`、`kafka_status`、`disk_usage`、`directory_usage`、`directory_usage_detail`。AI 不能生成 SQL、执行 Shell 或请求任意路径。目录、磁盘、服务器、Kafka 等确定运维问法跳过 AI 规划和整理，直接调用固定只读 Skill 与对应固定模板；广告等分析问题 AI 规划超时后使用受限规则兜底，AI 整理超时后返回固定格式结果。机器人向 Prometheus 暴露阶段耗时、成功/失败、兜底次数、在途请求与连接认证状态；结构化日志只记录消息 ID、Skill、耗时与错误类别，不记录聊天正文。

### 2.3 数据与消息层

| 服务 | 作用 | 持久化位置 |
|---|---|---|
| `postgres` | 用户、会话、成员、项目、神策接入、报表、查询任务、审计与对账元数据 | `/var/lib/aerolog/postgres` |
| `clickhouse` | 事件、用户行为与分析查询 | `/var/lib/aerolog/clickhouse` |
| `redis` | 会话、缓存、限流状态 | `/var/lib/aerolog/redis` |
| `redpanda` | Kafka 兼容消息队列 | `/var/lib/aerolog/redpanda` |
| `redpanda-console` | Topic、消费者组与积压查看 | 仅 `internal` |

Redpanda 对容器使用 `redpanda:9092`。神策订阅使用专用外部 listener `9092`，必须同时受云安全组和宿主机防火墙来源白名单保护，不能开放给任意公网地址。

### 2.4 监控层

| 服务 | 作用 |
|---|---|
| `prometheus` | 抓取 API、Collector、Consumer、神策消费者和 Node Exporter 指标，保留 7 天 |
| `node-exporter` | 宿主机 CPU、内存、磁盘等指标 |
| `grafana` | Prometheus 可视化仪表盘 |

企业微信告警由 API 运行期监控发送，可覆盖神策消费者、Kafka lag、DLQ、ClickHouse 写入与神策对账异常。告警 Webhook 不写入仓库。

## 3. 启动方式

```bash
cd /opt/aerolog/deploy/production

# 常规服务
docker compose up -d --build

# 包含神策事件与用户属性消费者
docker compose --profile sensorsdata up -d --build
```

首次启动 Grafana 前，宿主机数据目录必须可由 Grafana 容器 UID `472` 写入：

```bash
install -d -m 755 /var/lib/aerolog/grafana
chown -R 472:472 /var/lib/aerolog/grafana
```

部署代码：

```bash
cd /opt/aerolog
git pull --ff-only origin main
cd deploy/production
docker compose --profile sensorsdata up -d --build
```

若 API 被 `Recreate`，需重启独立登录代理，使其重新解析 API 容器地址：

```bash
docker restart aerolog-login-proxy
```

## 4. 常用排查

```bash
cd /opt/aerolog/deploy/production

# 服务状态与资源
docker compose --profile sensorsdata ps
docker stats --no-stream

# 数据链路日志
docker compose logs -f collector consumer --tail=100
docker compose --profile sensorsdata logs -f sensors-consumer sensors-profile-consumer --tail=100

# 企业微信机器人与 API
docker compose logs -f wecom-aibot api --tail=100

# 宿主机目录巡检
docker compose logs -f host-inspector --tail=100
```

| 现象 | 排查顺序 |
|---|---|
| 网站 `502` | `api` 是否存活 → 重启 `aerolog-login-proxy` → 检查 `web` |
| 自研埋点未入库 | `collector` → Redpanda Topic / consumer group → `consumer` → ClickHouse |
| 神策数据未入库 | Kafka `9092` 连通性 → 神策订阅应用状态 → `sensors-consumer` / `sensors-profile-consumer` → DLQ → ClickHouse |
| 神策对账差异 | 先查看数据覆盖起点与“部分覆盖”标识，再检查项目时区、事件映射与订阅生效时间 |
| 企业微信机器人无回复 | `wecom-aibot` 是否认证 → AI 规划/整理超时日志 → API 内部 Token → 对应 Skill 依赖 |
| 磁盘空间异常 | `directory_usage` Skill 或 `host-inspector` 日志；不要让机器人执行任意目录命令 |

## 5. 网络与密钥规则

- `internal` 是 Docker 内部网络；PostgreSQL、ClickHouse、Redis、Prometheus、Grafana、Redpanda Console 不直接暴露公网。
- `api-egress` 仅供神策 OpenAPI、企业微信、AI 服务等受控出网调用。
- `kafka-ingress` 承担外部 Kafka / 神策订阅链路；公网访问必须使用来源白名单。
- `.env` 保存数据库密码、神策 API Key、企业微信 Bot 凭据、AI Key、内部 Token；不得提交、不得打印日志。
- 公网入口规则仅保留在登录代理配置中；生产配置不应写死服务器 IP、域名、账号或密钥。

## 6. 企业微信 AI 机器人使用

在企业微信群中 `@AeroLog-ai-bot` 后直接提问。广告查询必须包含唯一 AeroLog 项目名；时间支持“今天”“昨天”“近/最近 N 小时”。

```text
@AeroLog-ai-bot 近三个小时的RbowDrama广告数据整理一下发我
@AeroLog-ai-bot 今天HaloDrama的广告数据
@AeroLog-ai-bot 昨天Talevra的ad_show数据

@AeroLog-ai-bot 服务器现在状态
@AeroLog-ai-bot Kafka积压和DLQ情况
@AeroLog-ai-bot 磁盘空间占用情况
@AeroLog-ai-bot 哪些目录占用空间最大
@AeroLog-ai-bot /usr目录里什么占用最大
```

机器人仅调用固定只读 Skill；不支持任意 SQL、Shell、文件读取、目录扫描或删除操作。每条正常回复末尾显示处理耗时与 AI Token：固定运维 Skill 为 `0（固定 Skill，未调用 AI）`；AI 服务未返回完整用量时显示未知。可在 Grafana 的 `AeroLog WeCom Bot` 面板查看连接状态、请求结果、阶段耗时、错误与兜底情况。

## 7. 相关文档

- [`architecture.md`](./architecture.md)：平台分层架构与容量演进
- [`production-deployment.md`](./production-deployment.md)：生产部署与维护
- [`observability.md`](./observability.md)：监控指标
- [`protocol.md`](./protocol.md)：SDK 上报协议
- [`todo.md`](./todo.md)：当前待办与暂缓范围
