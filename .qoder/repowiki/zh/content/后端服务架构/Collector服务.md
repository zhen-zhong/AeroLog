# Collector服务

<cite>
**本文引用的文件**
- [main.go](file://server/collector/cmd/main.go)
- [config.go](file://server/collector/internal/config/config.go)
- [track.go](file://server/collector/internal/handler/track.go)
- [cache.go](file://server/collector/internal/projectcache/cache.go)
- [producer.go](file://server/pkg/mq/producer.go)
- [metrics.go](file://server/pkg/metrics/metrics.go)
- [event.go](file://server/pkg/model/event.go)
- [README.md](file://server/collector/README.md)
- [docker-compose.yml](file://deploy/docker-compose.yml)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖分析](#依赖分析)
7. [性能考虑](#性能考虑)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本文件面向Collector服务的架构与实现，重点阐述其作为事件收集入口的职责：基于Gin框架的HTTP服务器、PostgreSQL连接池、Kafka生产者、项目级Token缓存机制，以及事件接收流程、请求验证、限流策略与错误处理。同时给出配置参数说明、监控指标暴露、优雅关闭机制与性能调优建议，并提供实际配置示例与常见问题排查方法。

## 项目结构
Collector服务位于 server/collector 目录，采用“命令入口 + 内部包”的分层组织方式：
- 命令入口：cmd/main.go 负责初始化配置、数据库连接池、Kafka生产者、项目缓存、HTTP路由与指标服务，并处理信号进行优雅关闭。
- 配置模块：internal/config/config.go 从环境变量读取配置，提供默认值。
- 事件处理：internal/handler/track.go 实现 /v1/track 路由，负责鉴权、请求体读取与解压、JSON解析、事件校验、封装上下文、投递Kafka与响应。
- 项目缓存：internal/projectcache/cache.go 提供基于内存的项目Token到ID映射缓存，减少数据库查询。
- 公共能力：server/pkg/mq/producer.go 提供Kafka异步生产者封装；server/pkg/metrics/metrics.go 提供Prometheus指标注册与独立的metrics服务；server/pkg/model/event.go 定义事件数据模型与基本校验。

```mermaid
graph TB
subgraph "Collector进程"
M["cmd/main.go<br/>启动与优雅关闭"]
CFG["internal/config/config.go<br/>环境变量配置"]
TH["internal/handler/track.go<br/>/v1/track处理器"]
PC["internal/projectcache/cache.go<br/>项目Token缓存"]
MQ["pkg/mq/producer.go<br/>Kafka生产者"]
MET["pkg/metrics/metrics.go<br/>Prometheus指标服务"]
EV["pkg/model/event.go<br/>事件模型"]
end
M --> CFG
M --> PC
M --> MQ
M --> MET
M --> TH
TH --> PC
TH --> MQ
TH --> EV
```

图表来源
- [main.go:22-73](file://server/collector/cmd/main.go#L22-L73)
- [config.go:19-30](file://server/collector/internal/config/config.go#L19-L30)
- [track.go:40-51](file://server/collector/internal/handler/track.go#L40-L51)
- [cache.go:18-32](file://server/collector/internal/projectcache/cache.go#L18-L32)
- [producer.go:12-40](file://server/pkg/mq/producer.go#L12-L40)
- [metrics.go:51-70](file://server/pkg/metrics/metrics.go#L51-L70)
- [event.go:27-60](file://server/pkg/model/event.go#L27-L60)

章节来源
- [main.go:1-74](file://server/collector/cmd/main.go#L1-L74)
- [config.go:1-38](file://server/collector/internal/config/config.go#L1-L38)
- [track.go:1-211](file://server/collector/internal/handler/track.go#L1-L211)
- [cache.go:1-57](file://server/collector/internal/projectcache/cache.go#L1-L57)
- [producer.go:1-69](file://server/pkg/mq/producer.go#L1-L69)
- [metrics.go:1-81](file://server/pkg/metrics/metrics.go#L1-L81)
- [event.go:1-84](file://server/pkg/model/event.go#L1-L84)

## 核心组件
- Gin HTTP服务器：在Release模式下运行，启用panic恢复中间件，注册/v1/track与/healthz健康检查端点。
- PostgreSQL连接池：通过pgxpool.New建立，用于项目Token到ID的查询与缓存。
- Kafka生产者：基于IBM/sarama的异步生产者，启用Snappy压缩、本地确认、批量刷新与重试。
- 项目缓存：以token为键的内存缓存，带过期时间，避免频繁访问数据库。
- 事件模型与校验：定义事件结构与基础校验规则，确保必要字段存在且长度合理。
- 指标与监控：独立的metrics端口暴露Prometheus指标，包含事件计数、请求耗时与Kafka发送错误计数。

章节来源
- [main.go:39-56](file://server/collector/cmd/main.go#L39-L56)
- [track.go:22-37](file://server/collector/internal/handler/track.go#L22-L37)
- [cache.go:18-32](file://server/collector/internal/projectcache/cache.go#L18-L32)
- [producer.go:17-40](file://server/pkg/mq/producer.go#L17-L40)
- [metrics.go:18-49](file://server/pkg/metrics/metrics.go#L18-L49)
- [event.go:27-60](file://server/pkg/model/event.go#L27-L60)

## 架构总览
Collector作为无状态的高并发HTTP入口，接收SDK上报的事件，完成鉴权、解析、校验与投递，最终返回受理/拒绝统计。其关键路径如下：

```mermaid
sequenceDiagram
participant SDK as "SDK"
participant Gin as "Gin路由"
participant TH as "TrackHandler"
participant PC as "项目缓存"
participant PG as "PostgreSQL"
participant MQ as "Kafka生产者"
participant Prom as "Prometheus"
SDK->>Gin : "POST /v1/track?token=..."
Gin->>TH : "调用handle()"
TH->>PC : "Resolve(token)"
alt "缓存命中"
PC-->>TH : "返回project_id"
else "缓存未命中"
TH->>PG : "查询projects表"
PG-->>TH : "返回project_id"
TH->>PC : "写入缓存"
end
TH->>TH : "读取并解压请求体"
TH->>TH : "JSON解析(单条或数组)"
loop "逐条事件"
TH->>TH : "Validate()基础校验"
TH->>TH : "封装EnvelopedEvent"
TH->>MQ : "Send(topic, key=distinct_id, value)"
MQ-->>TH : "成功/失败"
TH->>Prom : "更新计数与耗时"
end
TH-->>SDK : "返回受理/拒绝统计"
```

图表来源
- [main.go:40-48](file://server/collector/cmd/main.go#L40-L48)
- [track.go:60-133](file://server/collector/internal/handler/track.go#L60-L133)
- [cache.go:34-56](file://server/collector/internal/projectcache/cache.go#L34-L56)
- [producer.go:42-60](file://server/pkg/mq/producer.go#L42-L60)
- [metrics.go:26-42](file://server/pkg/metrics/metrics.go#L26-L42)

## 详细组件分析

### 配置模块（internal/config/config.go）
- 职责：从环境变量读取Collector运行所需的关键配置，提供默认值，便于快速启动。
- 关键参数：
  - 地址绑定：AEROLOG_ADDR，默认":8081"
  - 指标地址：AEROLOG_METRICS_ADDR，默认":9101"
  - KafkaBroker列表：AEROLOG_KAFKA_BROKERS，默认"localhost:19092"，逗号分隔
  - Kafka主题：AEROLOG_KAFKA_TOPIC，默认"events.raw"
  - PostgreSQL DSN：AEROLOG_PG_DSN，默认开发环境地址
  - Redis地址：AEROLOG_REDIS_ADDR，默认"localhost:6379"
  - 最大请求体大小：MaxBodyBytes，默认5MB
- 设计要点：使用字符串分割与默认值策略，确保部署灵活性。

章节来源
- [config.go:8-30](file://server/collector/internal/config/config.go#L8-L30)

### 事件处理（internal/handler/track.go）
- 路由注册：/v1/track POST，/healthz GET
- 鉴权：优先从查询参数获取token，其次从请求头X-AeroLog-Token；通过项目缓存解析project_id
- 请求体处理：限制最大字节数，支持gzip解压，兼容单条事件与事件数组
- 事件校验：调用Event.Validate()执行基础字段校验
- 上下文封装：为每条事件附加ProjectID、IP、UA、接收时间等信息
- Kafka投递：以DistinctID作为key，保证同一用户事件落入相同分区；超时控制为2秒
- 响应：返回受理/拒绝数量统计；错误时返回对应状态码与消息
- 指标：记录事件总数（含拒绝）、请求耗时直方图、Kafka发送错误计数

```mermaid
flowchart TD
Start(["进入handle"]) --> GetToken["提取token(查询参数或请求头)"]
GetToken --> Resolve["项目缓存Resolve(token)"]
Resolve --> CacheHit{"缓存命中？"}
CacheHit --> |是| ParseBody["读取并解压请求体"]
CacheHit --> |否| QueryDB["查询PostgreSQL projects表"]
QueryDB --> SaveCache["写入缓存"]
SaveCache --> ParseBody
ParseBody --> JSONParse["JSON解析(单条/数组)"]
JSONParse --> Loop{"遍历事件"}
Loop --> Validate["Validate()基础校验"]
Validate --> Valid{"校验通过？"}
Valid --> |否| IncReject["拒绝计数+1"]
Valid --> |是| Wrap["封装EnvelopedEvent"]
Wrap --> Send["Send(Kafka, key=distinct_id)"]
Send --> SentOK{"发送成功？"}
SentOK --> |否| ErrQueue["返回服务不可用"]
SentOK --> |是| IncAccept["受理计数+1"]
IncAccept --> Loop
IncReject --> Loop
Loop --> Done(["汇总返回受理/拒绝数量"])
```

图表来源
- [track.go:60-133](file://server/collector/internal/handler/track.go#L60-L133)
- [event.go:39-60](file://server/pkg/model/event.go#L39-L60)

章节来源
- [track.go:39-133](file://server/collector/internal/handler/track.go#L39-L133)
- [event.go:27-60](file://server/pkg/model/event.go#L27-L60)

### 项目缓存（internal/projectcache/cache.go）
- 结构：以token为键的map，存储project_id与过期时间；使用互斥锁保护并发安全
- 行为：先读锁尝试命中；未命中则查询PostgreSQL projects表（status=1），随后写入缓存并设置TTL
- 并发：读多写少场景下的RWMutex提升并发性能
- TTL：默认60秒，避免缓存击穿与陈旧数据

```mermaid
classDiagram
class Cache {
-mu RWMutex
-items map[string]entry
-pool *pgxpool.Pool
-ttl time.Duration
+Resolve(ctx, token) uint32,error
}
class entry {
+projectID uint32
+expireAt time.Time
}
Cache --> entry : "缓存项"
```

图表来源
- [cache.go:18-56](file://server/collector/internal/projectcache/cache.go#L18-L56)

章节来源
- [cache.go:1-57](file://server/collector/internal/projectcache/cache.go#L1-L57)

### Kafka生产者（pkg/mq/producer.go）
- 配置要点：版本、确认策略、压缩算法（Snappy）、批量刷新频率与消息数、重试次数、错误回调开关
- 发送语义：异步非阻塞发送，通过channel与context控制超时；错误通过独立goroutine消费，避免阻塞内部缓冲
- 关闭：提供Close接口，优雅退出

```mermaid
classDiagram
class Producer {
-p AsyncProducer
+Send(ctx, topic, key, value) error
+Close() error
}
Producer : "异步生产者封装"
```

图表来源
- [producer.go:12-69](file://server/pkg/mq/producer.go#L12-L69)

章节来源
- [producer.go:1-69](file://server/pkg/mq/producer.go#L1-L69)

### 指标与监控（pkg/metrics/metrics.go）
- 注册表：内置Go运行时与进程指标
- 指标类型：
  - 计数器：事件接收总数（受理/拒绝）
  - 直方图：/v1/track请求耗时
  - 错误计数：Kafka发送失败次数
- 服务：独立端口暴露/metrics与/healthz，支持优雅关闭

章节来源
- [metrics.go:18-81](file://server/pkg/metrics/metrics.go#L18-L81)

### 事件模型（pkg/model/event.go）
- 事件类型：track及用户属性相关类型枚举
- 字段：事件类型、事件名、匿名/登录标识、时间戳、SDK元信息、自定义属性
- 校验规则：必填字段检查、长度约束等，详细校验在下游消费者阶段执行

章节来源
- [event.go:9-60](file://server/pkg/model/event.go#L9-L60)

## 依赖分析
- 组件耦合：
  - main.go依赖配置、缓存、生产者与指标模块，形成入口聚合
  - track.go依赖缓存、生产者与事件模型，承担业务主流程
  - cache.go依赖pgxpool.Pool，提供轻量LRU式缓存
  - producer.go封装sarama异步生产者，提供非阻塞发送
  - metrics.go提供独立的Prometheus注册表与HTTP服务
- 外部依赖：
  - Gin：HTTP路由与中间件
  - pgxpool：PostgreSQL连接池
  - IBM/sarama：Kafka客户端
  - Prometheus：指标采集

```mermaid
graph LR
MAIN["cmd/main.go"] --> CFG["internal/config/config.go"]
MAIN --> PC["internal/projectcache/cache.go"]
MAIN --> MQ["pkg/mq/producer.go"]
MAIN --> MET["pkg/metrics/metrics.go"]
MAIN --> TH["internal/handler/track.go"]
TH --> EV["pkg/model/event.go"]
PC --> PG["pgxpool.Pool"]
TH --> PC
TH --> MQ
```

图表来源
- [main.go:17-48](file://server/collector/cmd/main.go#L17-L48)
- [track.go:3-20](file://server/collector/internal/handler/track.go#L3-L20)
- [cache.go:4-11](file://server/collector/internal/projectcache/cache.go#L4-L11)
- [producer.go:4-10](file://server/pkg/mq/producer.go#L4-L10)
- [metrics.go:6-16](file://server/pkg/metrics/metrics.go#L6-L16)
- [event.go:4-7](file://server/pkg/model/event.go#L4-L7)

章节来源
- [main.go:1-74](file://server/collector/cmd/main.go#L1-L74)
- [track.go:1-211](file://server/collector/internal/handler/track.go#L1-L211)
- [cache.go:1-57](file://server/collector/internal/projectcache/cache.go#L1-L57)
- [producer.go:1-69](file://server/pkg/mq/producer.go#L1-L69)
- [metrics.go:1-81](file://server/pkg/metrics/metrics.go#L1-L81)
- [event.go:1-84](file://server/pkg/model/event.go#L1-L84)

## 性能考虑
- 请求体限制：通过MaxBytesReader限制最大请求体，防止内存膨胀与DoS攻击
- 压缩传输：支持gzip解压，降低网络开销
- 批量与重试：Kafka生产者启用Snappy压缩、批量刷新与本地确认，提高吞吐与可靠性
- 分区键一致性：以DistinctID作为key，保障同一用户事件落在同一分区，利于后续处理
- 缓存命中：项目Token缓存减少数据库压力，建议根据流量调整TTL
- 指标观测：通过直方图与计数器定位瓶颈，结合外部Prometheus/Grafana进行可视化
- 并发与超时：读写分离的RWMutex与2秒发送超时，平衡吞吐与稳定性

## 故障排查指南
- 无法鉴权/401：
  - 检查token来源（查询参数或请求头）
  - 确认项目状态为有效（status=1）
  - 查看项目缓存是否命中
- 请求过大/400：
  - 检查MaxBodyBytes配置与请求体大小
  - 确认Content-Length与压缩格式
- Kafka不可用/503：
  - 检查KafkaBroker列表与网络连通性
  - 观察Kafka发送错误计数指标
  - 确认主题存在且分区/副本配置正确
- 健康检查：
  - /healthz用于快速判断服务存活
  - 指标服务/healthz用于判断监控端口可用性
- 优雅关闭：
  - 收到SIGINT/SIGTERM后，服务在5秒内优雅关闭HTTP与metrics服务

章节来源
- [track.go:67-83](file://server/collector/internal/handler/track.go#L67-L83)
- [track.go:113-128](file://server/collector/internal/handler/track.go#L113-L128)
- [metrics.go:59-61](file://server/pkg/metrics/metrics.go#L59-L61)
- [main.go:65-72](file://server/collector/cmd/main.go#L65-L72)

## 结论
Collector服务以简洁清晰的分层设计实现了高并发事件收集入口：通过Gin提供稳定HTTP服务，利用pgxpool与项目缓存降低鉴权成本，借助sarama异步生产者保障事件可靠投递，并通过独立的Prometheus端口实现可观测性。配合合理的配置与限流策略，可在生产环境中获得良好的吞吐与稳定性表现。

## 附录

### 配置参数与默认值
- AEROLOG_ADDR：服务监听地址，默认":8081"
- AEROLOG_METRICS_ADDR：指标服务地址，默认":9101"
- AEROLOG_KAFKA_BROKERS：Kafka Broker列表，默认"localhost:19092"
- AEROLOG_KAFKA_TOPIC：Kafka主题，默认"events.raw"
- AEROLOG_PG_DSN：PostgreSQL连接串，默认开发环境地址
- AEROLOG_REDIS_ADDR：Redis地址，默认"localhost:6379"
- MaxBodyBytes：最大请求体大小，默认5MB

章节来源
- [config.go:20-29](file://server/collector/internal/config/config.go#L20-L29)

### 启动与自测步骤
- 启动依赖（PostgreSQL、Redpanda、Prometheus、Grafana）
- 创建Kafka主题（如Redpanda未自动创建）
- 在PostgreSQL中插入测试项目并获取token
- 启动Collector并使用curl进行自测

章节来源
- [README.md:5-37](file://server/collector/README.md#L5-L37)
- [docker-compose.yml:3-147](file://deploy/docker-compose.yml#L3-L147)