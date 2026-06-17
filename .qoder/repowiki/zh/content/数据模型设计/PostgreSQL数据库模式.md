# PostgreSQL数据库模式

<cite>
**本文档引用的文件**
- [01_schema.sql](file://deploy/init/postgres/01_schema.sql)
- [governance.go](file://server/api/internal/handler/governance.go)
- [syncer.go](file://server/consumer/internal/metadata/syncer.go)
- [config.go](file://server/api/internal/config/config.go)
- [project.go](file://server/api/internal/handler/project.go)
- [analytics.go](file://server/api/internal/handler/analytics.go)
- [api.ts](file://web/src/lib/api.ts)
- [architecture.md](file://docs/architecture.md)
- [README.md](file://README.md)
</cite>

## 更新摘要
**变更内容**
- 扩展property_definitions表结构，新增status、first_seen、last_seen、updated_at字段
- 新增identity_mappings表，用于匿名ID与用户ID的映射关系
- 更新属性定义表的索引策略，支持新的时间戳字段查询
- 增强数据治理功能，支持属性状态管理和时间范围查询

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构概览](#架构概览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考虑](#性能考虑)
8. [故障排除指南](#故障排除指南)
9. [结论](#结论)

## 简介

AeroLog是一个自研的多端埋点平台，采用分层架构设计。本项目中的PostgreSQL数据库专门用于存储业务元数据，包括用户管理、项目管理、权限控制、事件定义、属性定义和身份映射等核心业务数据。根据架构设计，事件明细数据全部存储于ClickHouse，而PostgreSQL仅负责维护业务元数据。

该数据库模式设计遵循以下原则：
- **职责分离**：PostgreSQL存储业务元数据，ClickHouse存储事件明细
- **数据完整性**：通过外键约束确保数据一致性
- **性能优化**：针对查询场景设计合理的索引策略
- **可扩展性**：支持多租户架构和水平扩展
- **数据治理**：提供属性状态管理和时间范围追踪能力

## 项目结构

AeroLog项目采用模块化组织方式，数据库相关的核心文件位于`deploy/init/postgres/01_schema.sql`，该文件定义了完整的数据库模式。

```mermaid
graph TB
subgraph "数据库初始化"
S[01_schema.sql<br/>数据库模式定义]
end
subgraph "应用层"
A[API服务<br/>Go语言]
W[Web前端<br/>Next.js]
end
subgraph "数据存储"
PG[(PostgreSQL<br/>业务元数据)]
CH[(ClickHouse<br/>事件明细)]
DLQ[(PostgreSQL DLQ<br/>死信队列)]
end
S --> PG
A --> PG
W --> A
A --> CH
A --> DLQ
```

**图表来源**
- [01_schema.sql:1-120](file://deploy/init/postgres/01_schema.sql#L1-L120)
- [architecture.md:24-35](file://docs/architecture.md#L24-L35)

**章节来源**
- [01_schema.sql:1-120](file://deploy/init/postgres/01_schema.sql#L1-L120)
- [README.md:6-22](file://README.md#L6-L22)

## 核心组件

### 用户表 (users)

用户表是系统的核心实体，存储所有用户的基本信息和认证凭据。

| 字段名 | 数据类型 | 约束条件 | 描述 |
|--------|----------|----------|------|
| id | BIGSERIAL | PRIMARY KEY, AUTO_INCREMENT | 用户唯一标识符 |
| email | VARCHAR(255) | NOT NULL, UNIQUE | 用户邮箱地址 |
| name | VARCHAR(128) | NOT NULL | 用户显示名称 |
| password_hash | VARCHAR(255) | NOT NULL | BCrypt加密后的密码 |
| role | VARCHAR(32) | NOT NULL, DEFAULT 'member' | 用户角色：admin | member |
| status | SMALLINT | NOT NULL, DEFAULT 1 | 用户状态：1激活 | 0禁用 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 更新时间 |

### 项目表 (projects)

项目表代表一个独立的业务项目，每个项目都有自己的配置和权限体系。

| 字段名 | 数据类型 | 约束条件 | 描述 |
|--------|----------|----------|------|
| id | BIGSERIAL | PRIMARY KEY, AUTO_INCREMENT | 项目唯一标识符 |
| name | VARCHAR(128) | NOT NULL | 项目名称 |
| token | VARCHAR(64) | NOT NULL, UNIQUE | 应用密钥，用于SDK上报认证 |
| secret | VARCHAR(128) | NOT NULL | HMAC签名密钥，仅服务端使用 |
| description | TEXT | NULL | 项目描述信息 |
| status | SMALLINT | NOT NULL, DEFAULT 1 | 项目状态：1激活 | 0禁用 |
| created_by | BIGINT | REFERENCES users(id) | 创建者用户ID |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 更新时间 |

### 项目成员表 (project_members)

这是一个关联表，用于实现多对多的用户-项目关系，支持复杂的权限管理。

| 字段名 | 数据类型 | 约束条件 | 描述 |
|--------|----------|----------|------|
| project_id | BIGINT | NOT NULL, REFERENCES projects(id) ON DELETE CASCADE | 项目ID |
| user_id | BIGINT | NOT NULL, REFERENCES users(id) ON DELETE CASCADE | 用户ID |
| role | VARCHAR(32) | NOT NULL, DEFAULT 'viewer' | 成员角色：owner | editor | viewer |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 添加时间 |
| PRIMARY KEY | (project_id, user_id) | | 复合主键 |

### 事件定义表 (event_definitions)

存储事件的元数据定义，包括事件名称、显示名称和状态信息。

| 字段名 | 数据类型 | 约束条件 | 描述 |
|--------|----------|----------|------|
| id | BIGSERIAL | PRIMARY KEY, AUTO_INCREMENT | 事件定义唯一标识符 |
| project_id | BIGINT | NOT NULL, REFERENCES projects(id) ON DELETE CASCADE | 所属项目ID |
| name | VARCHAR(128) | NOT NULL | 事件内部名称（如$AppStart） |
| display_name | VARCHAR(128) | NULL | 事件显示名称 |
| description | TEXT | NULL | 事件描述信息 |
| status | SMALLINT | NOT NULL, DEFAULT 1 | 事件状态：1激活 | 0禁用 |
| first_seen | TIMESTAMPTZ | NULL | 首次出现时间 |
| last_seen | TIMESTAMPTZ | NULL | 最后出现时间 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 更新时间 |
| UNIQUE | (project_id, name) | | 项目内事件名称唯一性约束 |

### 属性定义表 (property_definitions)

存储属性的元数据定义，支持事件级和用户级属性。**已更新**：扩展了状态管理和时间追踪功能。

| 字段名 | 数据类型 | 约束条件 | 描述 |
|--------|----------|----------|------|
| id | BIGSERIAL | PRIMARY KEY, AUTO_INCREMENT | 属性定义唯一标识符 |
| project_id | BIGINT | NOT NULL, REFERENCES projects(id) ON DELETE CASCADE | 所属项目ID |
| name | VARCHAR(128) | NOT NULL | 属性名称 |
| display_name | VARCHAR(128) | NULL | 属性显示名称 |
| data_type | VARCHAR(32) | NOT NULL, DEFAULT 'string' | 数据类型：string | number | bool | datetime | list | object | mixed | unknown |
| scope | VARCHAR(32) | NOT NULL, DEFAULT 'event' | 作用域：event | user |
| description | TEXT | NULL | 属性描述信息 |
| status | SMALLINT | NOT NULL, DEFAULT 1 | 属性状态：1激活 | 0禁用 |
| first_seen | TIMESTAMPTZ | NULL | 首次出现时间 |
| last_seen | TIMESTAMPTZ | NULL | 最后出现时间 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 更新时间 |
| UNIQUE | (project_id, name, scope) | | 项目内属性名称唯一性约束 |

### 身份映射表 (identity_mappings)

**新增**：用于管理匿名ID与登录用户ID的映射关系，支持用户行为追踪和分析。

| 字段名 | 数据类型 | 约束条件 | 描述 |
|--------|----------|----------|------|
| id | BIGSERIAL | PRIMARY KEY, AUTO_INCREMENT | 映射记录唯一标识符 |
| project_id | BIGINT | NOT NULL, REFERENCES projects(id) ON DELETE CASCADE | 所属项目ID |
| anonymous_id | VARCHAR(255) | NOT NULL | 匿名用户标识符 |
| user_id | VARCHAR(255) | NOT NULL | 登录用户标识符 |
| first_seen | TIMESTAMPTZ | NULL | 首次绑定时间 |
| last_seen | TIMESTAMPTZ | NULL | 最后绑定时间 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 记录创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 记录更新时间 |
| UNIQUE | (project_id, anonymous_id, user_id) | | 项目内唯一映射约束 |

### 死信队列表 (event_dlq)

存储消费失败的事件数据，用于问题排查和重放。

| 字段名 | 数据类型 | 约束条件 | 描述 |
|--------|----------|----------|------|
| id | BIGSERIAL | PRIMARY KEY, AUTO_INCREMENT | 死信记录唯一标识符 |
| project_id | BIGINT | NULL | 所属项目ID |
| payload | JSONB | NOT NULL | 事件原始负载数据 |
| reason | TEXT | NOT NULL | 失败原因说明 |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 记录创建时间 |

### 看板表 (dashboards)

存储用户自定义的可视化看板配置。

| 字段名 | 数据类型 | 约束条件 | 描述 |
|--------|----------|----------|------|
| id | BIGSERIAL | PRIMARY KEY, AUTO_INCREMENT | 看板唯一标识符 |
| project_id | BIGINT | NOT NULL, REFERENCES projects(id) ON DELETE CASCADE | 所属项目ID |
| name | VARCHAR(128) | NOT NULL | 看板名称 |
| layout | JSONB | NOT NULL, DEFAULT '[]'::jsonb | 看板布局配置 |
| created_by | BIGINT | REFERENCES users(id) | 创建者用户ID |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 创建时间 |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 更新时间 |

**章节来源**
- [01_schema.sql:7-120](file://deploy/init/postgres/01_schema.sql#L7-L120)

## 架构概览

AeroLog采用分层架构，数据库层承担着重要的元数据管理职责。

```mermaid
graph TB
subgraph "客户端层"
SDK[SDK客户端<br/>Android/iOS/Web]
WEB[Web管理界面<br/>Next.js]
end
subgraph "服务层"
COL[Collector<br/>事件接收]
CON[Consumer<br/>数据处理]
API[API服务<br/>业务逻辑]
end
subgraph "存储层"
PG[PostgreSQL<br/>业务元数据]
CH[ClickHouse<br/>事件明细]
MINIO[MinIO<br/>原始归档]
end
subgraph "消息队列"
KAFKA[Kafka<br/>事件缓冲]
end
SDK --> COL
WEB --> API
COL --> KAFKA
KAFKA --> CON
CON --> CH
CON --> PG
API --> PG
API --> CH
```

**图表来源**
- [architecture.md:24-35](file://docs/architecture.md#L24-L35)
- [01_schema.sql:1-4](file://deploy/init/postgres/01_schema.sql#L1-L4)

## 详细组件分析

### 数据完整性约束

系统通过多种约束确保数据完整性：

#### 主键约束
- 所有表都定义了自增主键，确保每条记录的唯一性
- 复合主键用于项目成员表，防止重复添加成员
- 复合唯一约束用于属性定义表，支持同名属性在不同作用域下的存在

#### 外键约束
- 项目表的`created_by`字段引用用户表
- 事件定义表、属性定义表和身份映射表都引用项目表
- 项目成员表的两个字段分别引用项目表和用户表
- 看板表的`created_by`字段引用用户表

#### 唯一性约束
- 用户邮箱唯一，防止重复注册
- 项目令牌唯一，确保SDK认证安全
- 项目内事件名称唯一，避免事件冲突
- 项目内属性名称唯一，支持不同作用域的同名属性
- 项目内匿名ID与用户ID映射唯一，防止重复绑定

#### 非空约束
- 关键字段如邮箱、用户名、密码哈希、项目名称等都设置了NOT NULL约束
- 状态字段默认值确保新记录的状态正确
- 新增的身份映射表中，匿名ID和用户ID字段必须非空

#### 检查约束
- 状态字段使用SMALLINT类型，配合业务逻辑确保有效值范围
- 角色字段使用枚举值，限制可能的取值
- 数据类型字段使用枚举值，限制可能的取值

### 索引策略分析

基于查询模式分析，建议的索引策略如下：

#### 查询优化索引

```mermaid
flowchart TD
Start([查询优化分析]) --> Identify["识别高频查询模式"]
Identify --> Users["用户相关查询<br/>- email查找<br/>- 用户状态过滤"]
Identify --> Projects["项目相关查询<br/>- 项目令牌验证<br/>- 项目状态查询"]
Identify --> Members["成员关系查询<br/>- 用户项目权限<br/>- 项目成员列表"]
Identify --> Events["事件定义查询<br/>- 项目事件列表<br/>- 事件状态管理"]
Identify --> Properties["属性定义查询<br/>- 项目属性列表<br/>- 属性状态管理<br/>- 属性时间范围查询"]
Identify --> Identity["身份映射查询<br/>- 用户ID查找<br/>- 匿名ID查找<br/>- 映射关系查询"]
Users --> UserIdx["用户索引策略"]
Projects --> ProjIdx["项目索引策略"]
Members --> MemIdx["成员索引策略"]
Events --> EvIdx["事件索引策略"]
Properties --> PropIdx["属性索引策略"]
Identity --> IdxIdx["身份映射索引策略"]
UserIdx --> U1["email索引"]
UserIdx --> U2["status索引"]
ProjIdx --> P1["token索引"]
ProjIdx --> P2["created_by索引"]
ProjIdx --> P3["status索引"]
MemIdx --> M1["user_id索引"]
MemIdx --> M2["project_id索引"]
EvIdx --> E1["project_id索引"]
EvIdx --> E2["name索引"]
EvIdx --> E3["status索引"]
PropIdx --> PR1["project_id索引"]
PropIdx --> PR2["name索引"]
PropIdx --> PR3["status索引"]
PropIdx --> PR4["first_seen索引"]
PropIdx --> PR5["last_seen索引"]
IdIdx --> I1["user_id索引"]
IdIdx --> I2["anonymous_id索引"]
U1 --> End([完成])
U2 --> End
P1 --> End
P2 --> End
P3 --> End
M1 --> End
M2 --> End
E1 --> End
E2 --> End
E3 --> End
PR1 --> End
PR2 --> End
PR3 --> End
PR4 --> End
PR5 --> End
I1 --> End
I2 --> End
End([完成])
```

**图表来源**
- [01_schema.sql:7-120](file://deploy/init/postgres/01_schema.sql#L7-L120)

### 数据类型选择分析

#### 标识符设计
- 使用BIGSERIAL作为主键，支持大范围的ID分配
- 使用BIGINT作为外键，确保与主键类型一致

#### 字符串字段
- 邮箱使用VARCHAR(255)，符合RFC标准
- 用户名使用VARCHAR(128)，平衡存储和实用性
- 项目令牌使用VARCHAR(64)，满足SDK认证需求
- 事件名称使用VARCHAR(128)，支持复杂命名
- 匿名ID和用户ID使用VARCHAR(255)，支持各种标识符格式

#### 时间戳字段
- 使用TIMESTAMPTZ类型，存储带时区的时间信息
- 默认值使用now()函数，自动记录创建和更新时间
- 新增的first_seen和last_seen字段支持时间范围追踪

#### JSONB字段
- 使用JSONB存储灵活的配置数据
- 支持高效的查询和索引操作

**章节来源**
- [01_schema.sql:7-120](file://deploy/init/postgres/01_schema.sql#L7-L120)

## 依赖关系分析

### 外部依赖

系统依赖以下外部组件：

```mermaid
graph LR
subgraph "核心依赖"
PGX[pgx/v5<br/>PostgreSQL驱动]
CH[clickhouse-go<br/>ClickHouse客户端]
GIN[gin-gonic/gin<br/>Web框架]
end
subgraph "配置管理"
ENV[环境变量<br/>配置加载]
DSN[PostgreSQL DSN<br/>连接字符串]
end
subgraph "数据存储"
PG[(PostgreSQL)]
CHDB[(ClickHouse)]
end
PGX --> PG
CH --> CHDB
GIN --> API
ENV --> DSN
DSN --> PG
```

**图表来源**
- [config.go:24-38](file://server/api/internal/config/config.go#L24-L38)
- [project.go:10-11](file://server/api/internal/handler/project.go#L10-L11)

### 数据库连接配置

系统通过环境变量配置数据库连接参数：

| 配置项 | 默认值 | 用途 |
|--------|--------|------|
| AEROLOG_PG_DSN | postgres://aerolog:aerolog@localhost:5432/aerolog?sslmode=disable | PostgreSQL连接字符串 |
| AEROLOG_API_ADDR | :8082 | API服务监听地址 |
| AEROLOG_METRICS_ADDR | :9103 | 指标服务监听地址 |

**章节来源**
- [config.go:24-38](file://server/api/internal/config/config.go#L24-L38)

## 性能考虑

### 查询优化建议

基于当前的数据库模式，以下是性能优化建议：

#### 索引优化
1. **用户表**：为`email`和`status`字段建立索引
2. **项目表**：为`token`和`status`字段建立索引
3. **项目成员表**：为`user_id`和`project_id`字段建立索引
4. **事件定义表**：为`project_id`、`name`和`status`字段建立索引
5. **属性定义表**：为`project_id`、`name`、`status`、`first_seen`和`last_seen`字段建立索引
6. **身份映射表**：为`project_id`、`user_id`和`anonymous_id`字段建立索引

#### 查询模式优化
1. **分页查询**：使用LIMIT和OFFSET进行分页
2. **条件过滤**：优先使用WHERE子句过滤数据
3. **排序优化**：为常用排序字段建立索引
4. **时间范围查询**：利用first_seen和last_seen字段进行时间范围过滤

#### 连接池配置
1. **连接复用**：使用pgx连接池减少连接开销
2. **超时设置**：合理设置查询超时时间
3. **并发控制**：限制最大连接数防止资源耗尽

### 存储优化

#### 数据压缩
- 使用JSONB存储配置数据，支持高效压缩
- 合理设计表结构，避免冗余字段

#### 归档策略
- 定期清理历史数据，保持表大小可控
- 对不常访问的数据进行归档

## 故障排除指南

### 常见问题及解决方案

#### 连接问题
1. **检查连接字符串格式**
   - 确认DSN格式正确
   - 验证主机名、端口、数据库名
   - 检查SSL配置

2. **验证认证信息**
   - 确认用户名和密码正确
   - 检查数据库权限设置

#### 数据完整性错误
1. **唯一性约束冲突**
   - 检查重复的邮箱或令牌
   - 验证项目内事件名称的唯一性
   - 验证项目内属性名称的唯一性
   - 验证身份映射的唯一性

2. **外键约束错误**
   - 确认引用的记录存在
   - 检查删除级联设置

#### 性能问题
1. **慢查询诊断**
   - 使用EXPLAIN ANALYZE分析查询计划
   - 检查索引使用情况
   - 优化WHERE和JOIN条件

2. **内存使用监控**
   - 监控查询内存使用
   - 调整查询结果集大小

#### 新功能相关问题
1. **属性状态管理问题**
   - 检查属性状态字段是否正确更新
   - 验证first_seen和last_seen时间戳的准确性

2. **身份映射查询问题**
   - 确认索引是否正确创建
   - 检查查询条件是否匹配索引

**章节来源**
- [config.go:24-38](file://server/api/internal/config/config.go#L24-L38)
- [01_schema.sql:7-120](file://deploy/init/postgres/01_schema.sql#L7-L120)

## 结论

AeroLog的PostgreSQL数据库模式设计体现了清晰的职责分离和良好的数据完整性保障。通过将业务元数据与事件明细分离存储，系统实现了高性能的事件处理能力，同时保持了完善的权限管理和配置灵活性。

### 设计优势

1. **架构清晰**：明确区分元数据和事件数据的存储职责
2. **扩展性强**：支持多租户架构和水平扩展
3. **性能优异**：针对查询场景优化索引策略
4. **安全可靠**：通过外键约束和唯一性约束确保数据完整性
5. **治理完善**：新增的属性状态管理和身份映射功能增强了数据治理能力

### 发展建议

1. **监控完善**：增加数据库性能监控和告警机制
2. **备份策略**：制定定期备份和灾难恢复计划
3. **容量规划**：根据业务增长制定扩容计划
4. **安全加固**：定期审查权限配置和安全策略
5. **索引优化**：根据实际查询模式调整索引策略

该数据库模式为AeroLog平台提供了坚实的数据基础，支持平台的持续发展和业务扩展需求。新增的属性状态管理和身份映射功能进一步增强了系统的数据治理能力和用户体验追踪能力。