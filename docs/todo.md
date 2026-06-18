# AeroLog 后续待办

## 已完成

- SDK Debugger 增加 Collector 侧拒绝事件记录，覆盖 token 错误、基础字段缺失、签名失败等未进入 Kafka 的请求。
- Schema 校验增加事件级规则：事件是否启用、事件必带参数集合。
- 用户时间线按 session 分组，并支持从查询结果、调试事件一键跳转到用户行为明细。
- SDK Debugger 数据增加脱敏与保留周期，默认清理 7 天前的 debug_events、schema_issues 和 schema_issue_groups。
- API/Consumer 请求链路移除运行时 DDL，元数据表统一由启动期 bootstrap 与迁移脚本维护。
- 项目增加签名强制开关，Collector 支持全局强制和项目级强制两种模式。
- Schema 问题增加聚合表，按事件、参数、期望/实际类型和错误消息归并并累计次数。
- 用户事件时间线默认按身份映射合并 distinct_id、user_id、anonymous_id 后查询。
- 事件级 Schema 隔离：`property_definitions` 增加 `event` 列与 `(project_id,name,scope,event)` 唯一键；Consumer 校验、API 治理、Web 治理页全部按事件加载/编辑属性，事件级规则覆盖全局默认。
- Android SDK 接入 `X-AeroLog-Signature`：`AeroConfig.secret` 配置项目密钥后自动用 HMAC-SHA256 对请求体签名上报。

## P0

（暂无）

## P1

- 转化目标增加趋势对比、目标版本记录、参数拆解结果导出。
- 自助查询支持保存模板、分享链接、CSV 导出和大结果异步任务。
- 数据治理增加批量编辑、属性负责人、废弃/隐藏状态和变更审计。
- Android SDK 增加 gzip、DebugView 本地日志开关和更完整的自动采集配置。

## P2

- 多项目权限与成员管理，区分 owner/editor/viewer。
- 告警中心：Schema 错误率、事件量突降、关键转化异常。
- 接入 OpenTelemetry Dashboard，统一展示 collector/consumer/api 延迟、吞吐和 DLQ。
- 补 iOS/Web SDK，并统一 SDK 发布、版本兼容矩阵和示例应用。
