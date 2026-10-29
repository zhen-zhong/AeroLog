# AeroLog 生产部署与维护手册

本文提供可复用的生产部署模板与故障处理方式。不记录任何具体主机、账号、域名或供应商信息。

> **最近更新**
> **使用前**：在私有 `.env` 填入实际值；不要将主机、域名、账号、密码或证书信息提交到仓库。

## 1. 当前部署概览

服务器：`<deploy-user>@<server-host>`

应用目录：`<deployment-root>`

生产编排目录：`<deployment-root>/deploy/production`

当前部署的是核心分析链路、Redpanda Console 与监控栈：

```text
浏览器 / SDK
        │
        ▼
  外部反向代理（独立管理）
      ├── /              → Next.js Web（AeroLog）
      ├── /aerolg        → AeroLog 入口跳转
      ├── /aerolog       → AeroLog 入口跳转
      ├── /api/v1/*      → API
      ├── /collect/v1/*  → Collector
      ├── /queue/*       → Redpanda Console（Basic Auth）
      ├── /monitor/*     → Grafana（Basic Auth）
      ├── /tools/        → 工具集索引（无需登录）
      └── /tools/movie/* → vidsrc-parser 工具容器（无需登录）

Collector → Redpanda → Consumer → ClickHouse
                     ↘
                       PostgreSQL / Redis
```

已运行服务：

| 服务 | 作用 | 是否直接暴露公网 |
|---|---|---|
| 外部反向代理 | 唯一入口、反向代理；不由本编排管理 | 是，由网关单独管理 |
| Web | AeroLog 控制台与营销页面 | 否 |
| API | 登录、项目、分析接口 | 否 |
| Collector | SDK 埋点接收 | 否，通过 `/collect/` |
| Consumer | 消费事件并写入 ClickHouse | 否 |
| PostgreSQL | 用户、权限、项目等元数据 | 否 |
| Redis | 缓存与辅助状态 | 否 |
| Redpanda | Kafka 兼容消息队列 | 默认否；神策订阅专用 `9092` 仅允许白名单来源 |
| Redpanda Console | Topic、消费组查看工具 | 否，通过 `/queue/` 且需认证 |
| ClickHouse | 事件明细与分析查询 | 否 |
| Prometheus | API、Collector、Consumer 运行指标采集（保留 7 天） | 否 |
| Grafana | 监控仪表盘 | 否，通过 `/monitor/` 且需认证 |
| Tools / movie | `vidsrc-parser` 前端工具，独立 Docker Compose 项目 | 否，通过 `/tools/movie/`，无需登录 |

MinIO 当前未部署；Prometheus 指标保留期设为 7 天，以控制小规格服务器的资源占用。

## 2. 访问地址与账户

- AeroLog：首页 `https://analytics.example.com/`，快捷入口 `https://analytics.example.com/aerolog`
- API：`https://analytics.example.com/api/v1/`
- 埋点入口：`https://analytics.example.com/collect/v1/track`
- Redpanda Console：`https://analytics.example.com/queue/`
- Grafana 监控面板：`https://analytics.example.com/monitor/`
- 工具集合索引：`https://analytics.example.com/tools/`
- 工具集合 / movie：`https://analytics.example.com/tools/movie/`

`/queue/` 与 `/monitor/` 需要 Nginx Basic Auth；`/tools/` 与 `/tools/movie/` 不接入 AeroLog 登录态，也不配置 Basic Auth。

Grafana 先经过 Nginx Basic Auth，再显示 Grafana 自身登录页；两层认证均使用已配置的管理员账号。通过 `.env` 配置 `GF_SERVER_DOMAIN` 与 `GF_SERVER_ROOT_URL`。不要直接开放 Grafana 的 `3000` 端口。

首次启动已创建两个平台管理员账户。账户邮箱和初始密码只保存在服务器的受限环境文件中，不要在代码、Issue、文档或截图中记录明文密码。

环境文件位置：

```bash
sudo ls -l <deployment-root>/deploy/production/.env
```

它应始终保持 `600` 权限、由 `root` 拥有。该文件包含数据库密码、ClickHouse 密码、JWT 密钥和首次管理员初始化参数。

### 2.1 SDK 接入到当前部署

生产环境必须显式覆盖 SDK 的 `serverUrl`，指向 Nginx 的 `/collect` 路由：

```kotlin
// Android
AeroLog.init(
    application,
    AeroConfig(
        token = "YOUR_PROJECT_TOKEN",
        serverUrl = "https://analytics.example.com/collect",
    ),
)
```

```ts
// Web
import { init } from "aerolog";
const aero = init({
    token: "YOUR_PROJECT_TOKEN",
    serverUrl: "https://analytics.example.com/collect",
});
```

```swift
// iOS
AeroLog.shared.setup(AeroConfig(
    token: "YOUR_PROJECT_TOKEN",
    serverUrl: "https://analytics.example.com/collect"
))
```

说明：
- SDK 请求路径为 `${serverUrl}/v1/track?token=...`，与 Nginx 反代规则 `/collect/v1/*` 对齐。
- 推荐通过 HTTPS 反向代理访问；源站容器可仅监听 HTTP `80`。
- 避免直接使用源站 IP 调试。iOS App 默认拒绝明文 HTTP；Android 9+ 也需明确的网络安全配置。

### 2.2 接口响应结构

API 与 Collector 的 JSON 响应统一为三段：

```json
{
  "data": {},
  "message": "ok",
  "code": 0
}
```

约定：

- `data`：业务数据。错误场景通常为 `null`；Collector 会返回 `{ "accepted": 0, "rejected": 0 }` 这类处理统计。
- `message`：人类可读提示。成功默认为 `ok`；错误时放错误原因。
- `code`：业务码。成功为 `0`；API 普通错误默认使用 HTTP 状态码；Collector 保留更细的采集错误码，例如无效 token 为 `4001`。

示例：

```json
{"data":null,"message":"unauthorized","code":401}
```

```json
{"data":{"accepted":0,"rejected":0},"message":"invalid token","code":4001}
```

## 3. 首次部署步骤（已执行）

1. 清空旧 Docker 服务、镜像和卷。
2. 使用 SSH 密钥连接服务器。
3. 从 Git 仓库克隆项目到 `<deployment-root>`。
4. 创建仅 root 可读的 `.env` 和 `queue.htpasswd`。
5. 构建四个应用镜像：Web、API、Collector、Consumer。
6. 启动 Docker Compose 核心栈。
7. 验证首页、管理员登录、Redpanda 健康状态与 Console 认证。

生产编排文件位于仓库：

```text
deploy/production/docker-compose.yml
deploy/production/Dockerfile.go
deploy/production/Dockerfile.web
deploy/production/nginx.conf
```

## 4. 日常检查

登录服务器后执行：

```bash
cd <deployment-root>/deploy/production
sudo docker compose ps
sudo docker stats --no-stream
free -h
df -h
```

检查网页与 API：

```bash
curl -I http://127.0.0.1/
curl http://127.0.0.1/api/healthz
curl -I http://127.0.0.1/queue/
```

预期结果：

- 首页返回 `200`；
- API 健康检查返回 `ok`；
- 未携带 Redpanda Console 认证时 `/queue/` 返回 `401`；
- `postgres`、`clickhouse`、`redpanda` 显示为 `healthy`。
- Grafana 打开后应能看到 AeroLog 预置监控面板，Prometheus Targets 中 API、Collector、Consumer 应为 `UP`。

## 5. 查看日志

```bash
cd <deployment-root>/deploy/production

# 查看全部服务最后 200 行日志
sudo docker compose logs --tail=200

# 持续跟踪指定服务
sudo docker compose logs -f api
sudo docker compose logs -f collector
sudo docker compose logs -f consumer
sudo docker compose logs -f redpanda
sudo docker compose logs -f web
```

常见排查方向：

| 现象 | 优先查看 |
|---|---|
| 无法登录 | `api`、`postgres` 日志；确认 API 健康与管理员账户状态 |
| 埋点没有入库 | `collector`、`redpanda`、`consumer` 日志 |
| 分析页面报错或慢 | `api`、`clickhouse` 日志与内存占用 |
| 消息积压 | `/queue/` 中的 Topic 与 Consumer Group |
| 页面 502/无法打开 | `nginx`、`web` 日志 |

## 6. 更新部署

在确认 GitHub `main` 已包含待发布改动后执行：

```bash
cd <deployment-root>
git status --short
git pull --ff-only

cd deploy/production
sudo docker compose build
sudo docker compose up -d --no-build
sudo docker compose ps
```

这是唯一的常规发布流程：**本地修改并提交推送 → 服务器 `git pull --ff-only` → 构建并启动服务**。`git status --short` 必须为空；不要用 `git reset`、`git checkout --` 或 `git clean` 覆盖服务器文件。外部反向代理由其独立配置和发布流程管理，不执行已移除的 `docker compose ... nginx` 命令。

构建 Go 服务时已固定使用 `goproxy.cn`，用于规避服务器无法稳定连接 `proxy.golang.org` 的问题。

服务重建后如果外部网关短暂返回 `502 Bad Gateway`，确认目标容器健康，并按网关自身的发布方式重新加载其配置：

```bash
sudo docker compose ps api collector web
```

然后重新验证：

```bash
curl -i http://127.0.0.1/api/v1/auth/me
curl -i -X POST 'http://127.0.0.1/collect/v1/track?token=invalid' \
  -H 'Content-Type: application/json' \
  --data '[]'
```

仅更新前端时可缩短为：

```bash
cd <deployment-root>/deploy/production
sudo docker compose build web
sudo docker compose up -d --no-deps --force-recreate web
```

仅更新工具集合时：

```bash
cd <deployment-root>/tools/moive
sudo docker compose build
sudo docker compose up -d --remove-orphans

cd <deployment-root>/deploy/production
sudo docker compose exec nginx nginx -t
sudo docker compose exec nginx nginx -s reload
```

仅重启单个服务：

```bash
sudo docker compose restart api
sudo docker compose restart collector
sudo docker compose restart consumer
```

不要使用 `docker compose down -v`，除非明确要删除所有数据库、队列与分析数据。

### 6.1 神策 Kafka 订阅入口

Redpanda 保留容器内 `redpanda:9092` 给 AeroLog 自身使用，并单独映射主机 IPv4 `9092` 给神策私有化服务器。外部 listener 的公告地址仅通过服务器私有 `.env` 的 `AEROLOG_KAFKA_EXTERNAL_ADVERTISED_ADDR` 配置，不能提交真实 IP 或域名。

神策与 AeroLog 位于同一私网时，同时将 `.env` 的 `AEROLOG_KAFKA_BIND_ADDR` 设为 AeroLog 的私网 IPv4；不要以 `0.0.0.0` 绑定并通过公网传输。

云安全组和主机防火墙都必须只放行神策服务器的单个 IPv4 地址。安装防火墙规则：

```bash
sudo install -D -m 755 deploy/production/scripts/apply-kafka-firewall.sh /usr/local/lib/aerolog/apply-kafka-firewall.sh
sudo install -D -m 644 deploy/production/systemd/aerolog-kafka-firewall.service /etc/systemd/system/aerolog-kafka-firewall.service
sudo sh -c 'printf "%s\n" "AEROLOG_SENSORS_KAFKA_SOURCE_CIDR=<sensors-server-ip>/32" > /etc/default/aerolog-kafka-firewall'
sudo systemctl daemon-reload
sudo systemctl enable --now aerolog-kafka-firewall.service
sudo systemctl status aerolog-kafka-firewall.service --no-pager
```

从神策服务器验证时使用 `nc -vz -w 5 <aerolog-kafka-public-host> 9092`，再使用 `kcat -b '<aerolog-kafka-public-host>:9092' -L`。不得对其他公网地址开放该端口；本期也不启用离线导出、JDBC 或历史回补。

### 6.2 复用已有 Kafka

若服务器已有独立管理的 Kafka，可不启动本编排的 `redpanda`，并在仅服务器可读的 `.env` 中设置：

```bash
AEROLOG_KAFKA_BROKERS=<managed-kafka-private-host>:9092
AEROLOG_KAFKA_TOPIC=aerolog.test.events.raw
AEROLOG_GROUP_ID=aerolog-test-consumer
```

随后仅启动核心服务，不能使用无服务名的 `docker compose up`，以免启动同机不需要的队列或监控组件：

```bash
docker compose up -d --no-build postgres redis clickhouse api web collector consumer
```

编排会只给 Collector 和 Consumer 额外加入出站网络，以访问受管理 Kafka；PostgreSQL、Redis、ClickHouse 仍保持在 Docker 内部网络，且不发布宿主机端口。

受管理 Kafka 必须将 listener 绑定到私网 IPv4，并限制 `9092` 来源。以下规则保留神策节点、AeroLog Docker 出站网段和本机；不要将任意公网或整个私网网段加入白名单：

```bash
sudo install -D -m 755 deploy/production/scripts/apply-managed-kafka-firewall.sh /usr/local/lib/aerolog/apply-managed-kafka-firewall.sh
sudo install -D -m 644 deploy/production/systemd/aerolog-managed-kafka-firewall.service /etc/systemd/system/aerolog-managed-kafka-firewall.service
sudo sh -c 'printf "%s\n" "AEROLOG_MANAGED_KAFKA_SOURCE_CIDRS=<sensors-node-private-ip>/32 <docker-egress-subnet> <kafka-host-private-ip>/32" > /etc/default/aerolog-managed-kafka-firewall'
sudo systemctl daemon-reload
sudo systemctl enable --now aerolog-managed-kafka-firewall.service
```

由神策订阅写入的 topic 应与 AeroLog SDK 原始事件 topic 隔离，例如 `aerolog.test.sensors.events.v1`、`aerolog.test.sensors.profiles.v1`、`aerolog.test.sensors.details.v1`。首次只验证 Kafka 可接收消息；将神策事件转换并写入 AeroLog 分析表前，需单独启用对应的导入消费者，避免把两种事件协议混写到 `AEROLOG_KAFKA_TOPIC`。

神策事件导入使用 profile 隔离的 `sensors-consumer`。多个 AeroLog 项目复用一个神策订阅应用和两条 Topic；消费者读取消息中的神策 `project_id`，按控制台保存的映射写入对应 AeroLog 项目。服务器私有 `.env` 配置共享订阅应用与加密密钥：

```bash
AEROLOG_SENSORS_EVENTS_TOPIC=<sensors-events-topic>
AEROLOG_SENSORS_PROFILES_TOPIC=<sensors-profiles-topic>
AEROLOG_SENSORS_APPLICATION_NAME=<shared-sensors-application-name>
AEROLOG_INTEGRATION_ENCRYPTION_KEY=<random-server-only-secret>
# 完成所有现有项目映射后必须为 0；仅迁移旧单项目订阅时临时使用。
AEROLOG_SENSORS_TARGET_PROJECT_ID=0
# Synchronous, bounded ClickHouse writes. Failed writes keep the Kafka offset.
AEROLOG_CONSUMER_BATCH_SIZE=200
AEROLOG_CONSUMER_BATCH_MS=5000
AEROLOG_CONSUMER_WRITE_TIMEOUT_MS=15000
AEROLOG_CONSUMER_RETRY_INITIAL_MS=1000
AEROLOG_CONSUMER_RETRY_MAX_MS=30000
```

启动导入器：

```bash
docker compose --profile sensorsdata up -d --build sensors-consumer
```

启动后，在 `管理 → 项目管理 → 神策接入` 为每个项目输入神策服务地址、项目英文名和 API Key。服务端查询既有共享订阅应用、创建“所有事件 + 所有普通属性”订阅，并保存 `神策 project_id → AeroLog project_id` 路由。API Key 使用 `AEROLOG_INTEGRATION_ENCRYPTION_KEY` AES-GCM 加密保存，接口仅返回掩码。若项目已在共享应用上有订阅，选择“复用已有神策订阅”并填写神策项目 ID，避免重复订阅。

事件与用户 profile 分别使用独立 Kafka topic、consumer group 和容器；神策 `project_id` 不会直接作为 AeroLog `project_id`，以避免跨平台 ID 冲突。事件消费者也会创建仅含身份信息的用户快照，因此 profile topic 尚未产生数据时，用户列表仍可展示已观测身份。ClickHouse 写入失败时会保留 Kafka offset 并指数退避重试，写入成功后才提交 offset。

## 7. 数据与备份

持久化数据位于：

```text
<data-root>/postgres
<data-root>/redis
<data-root>/redpanda
<data-root>/clickhouse
<data-root>/prometheus
<data-root>/grafana
```

将数据目录与代码仓库解耦；具体挂载路径由私有部署配置决定。

不要对 `<deployment-root>` 执行递归属主修复后再覆盖生产数据。尤其禁止用下面这种命令作为常规维护动作：

```bash
sudo chown -R <deploy-user>:<deploy-group> <deployment-root>
```

如果必须修复代码目录属主，只处理代码和配置文件，并排除生产数据目录：

```bash
sudo find <deployment-root> \
  -path <data-root> -prune \
  -o -exec chown <deploy-user>:<deploy-group> {} +
```

当前生产数据目录的推荐属主：

| 目录 | 容器用户 | 修复命令 |
|---|---|---|
| `<data-root>/postgres` | `70:70` | `sudo chown -R 70:70 <data-root>/postgres` |
| `<data-root>/redpanda` | `101:101` | `sudo chown -R 101:101 <data-root>/redpanda` |
| `<data-root>/grafana` | `472:0` | `sudo chown -R 472:0 <data-root>/grafana` |
| `<data-root>/prometheus` | `65534:65534` | `sudo chown -R 65534:65534 <data-root>/prometheus` |

Redis、ClickHouse 当前可沿用迁移后的目录权限；如出现 `permission denied`，先查看对应容器日志和挂载目录属主，再按镜像内运行用户修复。

至少应定期备份 PostgreSQL 元数据：

```bash
sudo mkdir -p /var/backups/aerolog
sudo sh -c 'cd <deployment-root>/deploy/production && \
  set -a && . ./.env && set +a && \
  docker compose exec -T postgres pg_dump -U aerolog aerolog \
  > /var/backups/aerolog/postgres-$(date +%F).sql'
```

ClickHouse 与 Redpanda 保存事件数据，数据量增长较快。生产环境应进一步接入对象存储或异机备份，并监控磁盘容量。不要在服务运行时直接复制其数据目录作为唯一备份方案。

## 8. 资源与扩容建议

首次验证时，核心容器常驻内存约 1.6 GiB（含监控栈）；ClickHouse 与 Redpanda 是主要增长项。

- 当前 3.6 GiB 机器适合内测和低频真实流量；`free -h` 可用 1–2 GiB，剩余较紧张。
- 持续埋点与复杂分析建议升级到至少 8 GiB；
- 有较多项目、长期事件留存或监控栈时建议使用 16 GiB 和更大的 NVMe 磁盘；
- Prometheus 保留期设为 7 天；若磁盘或内存压力升高，优先缩短或临时停掉 Prometheus / Grafana。
- 新增 MinIO 前，先确认内存与磁盘余量。

## 9. 已知部署注意事项

1. Redpanda 的宿主机数据目录需要可由容器用户写入。首次创建目录后如出现 `Permission denied`，执行：

   ```bash
   sudo chown -R 101:101 <data-root>/redpanda
   sudo rm -f <data-root>/redpanda/pid.lock
   sudo docker compose restart redpanda
   ```

2. Next.js 生产镜像必须将构建产物放在 `.next` 目录；生产 Dockerfile 已处理。

3. 当前入口使用 HTTP。正式对外使用前，应配置域名、HTTPS 证书和服务器安全组，仅开放 `80/443`。

4. Redpanda Console 的 `/queue/` 已有 Basic Auth；不要暴露 `9092`、`9644`、`8088` 等消息队列原生管理端口。认证文件 `queue.htpasswd` 需保持为 `root:101`、权限 `640`，使 Nginx 工作进程能够读取密码哈希但普通用户无法读取：

   ```bash
   sudo chown root:101 <deployment-root>/deploy/production/queue.htpasswd
   sudo chmod 640 <deployment-root>/deploy/production/queue.htpasswd
   sudo docker compose -f <deployment-root>/deploy/production/docker-compose.yml exec -T nginx nginx -s reload
   ```

5. 归因分析中 CTE 的 `dim` 参数顺序已修正并有回归测试。每次发布前建议至少运行：

   ```bash
   cd <deployment-root>/server/api
   go test ./...
   ```

6. SDK 必须显式覆盖 `serverUrl` 为私有部署的 `https://<public-host>/collect`，详见§2.1。

7. `tools/moive` 是独立工具项目，源码位于 `<deployment-root>/tools/moive`，使用自己的 `docker-compose.yml` 构建并接入内部网络。外层 Nginx 通过 Docker 内部 DNS 转发 `/tools/movie/`；`/tools/` 是公开工具索引，工具入口不需要 AeroLog 登录；历史 `/tools/moive/` 仅保留跳转。

## 10. 紧急恢复顺序

当服务整体异常时，按以下顺序恢复：

```bash
cd <deployment-root>/deploy/production
sudo docker compose up -d --no-build
sudo docker compose ps
sudo docker compose logs --tail=100 redpanda clickhouse postgres api collector consumer
```

若网页仍不可访问，优先确认外部网关与 Web：

```bash
sudo docker compose restart web
curl -I http://127.0.0.1/
```

若事件未入库，确认 `redpanda` 为 healthy 后，再依次重启：

```bash
sudo docker compose restart collector consumer
```

## 11. 域名与 HTTPS 路线

部署要求：

- 仅由反向代理暴露 `80/443`；数据库、监控服务保持在私有网络。神策实时订阅例外：Kafka `9092` 仅对批准的源 IP 开放，并受云安全组和主机防火墙双重限制。
- 在 `.env` 中定义 `AEROLOG_PUBLIC_HOST`，并在 DNS 与 TLS 证书中配置同一个域名。
- Nginx 默认 `server_name _;`，不会将某个部署域名写入仓库。
- `/aerolog` 用作控制台快捷入口；`/tools/` 用作工具集入口；`/tools/movie/` 访问 movie 工具。

可选路径：

| 方案 | 描述 | 优劣势 |
|---|---|---|
| **A. CDN 或反向代理终止 TLS** | DNS 指向代理层，源站只监听私网或 `80`。 | 易管理；需正确配置回源安全。 |
| **B. 源站配置 TLS** | 在 Docker Nginx 挂载证书并开放 `443`。 | 链路完整；需维护证书续期。 |
| **C. 私网接入** | 通过 VPN、零信任网络或内网入口访问。 | 攻击面小；需要额外网络配置。 |

记录以供后续决策。一旦选定路线，需同步调整：

1. **Nginx**：`server_name`、路径转发、工具入口和 Basic Auth realm。
2. **Grafana**：`GF_SERVER_DOMAIN` / `GF_SERVER_ROOT_URL`。
3. **SDK 接入地址**：在应用配置中显式填写真实公网域名，不要提交到仓库。
4. **安全组 / 防火墙**：仅开放 `80/443`，关闭不必要的原生端口。
5. **HTTPS 证书**：使用受信任的证书签发与自动续期方案，并以挂载或密钥管理服务注入 Nginx。
