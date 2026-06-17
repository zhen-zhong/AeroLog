# AeroLog 后续待办

## 已完成

- SDK Debugger 增加 Collector 侧拒绝事件记录，覆盖 token 错误、基础字段缺失、签名失败等未进入 Kafka 的请求。
- Schema 校验增加事件级规则：事件是否启用、事件必带参数集合。
- 用户时间线按 session 分组，并支持从查询结果、调试事件一键跳转到用户行为明细。

## P0

- 事件级 Schema 继续增强：同名参数按事件隔离配置类型、枚举和必填规则。
- Android SDK 接入 `X-AeroLog-Signature`，正式启用 HMAC 上报签名。

## P1

- 转化目标增加趋势对比、目标版本记录、参数拆解结果导出。
- 自助查询支持保存模板、分享链接、CSV 导出和大结果异步任务。
- 数据治理增加批量编辑、属性负责人、废弃/隐藏状态和变更审计。
- Android SDK 增加 gzip、HMAC 签名、DebugView 本地日志开关和更完整的自动采集配置。

## P2

- 多项目权限与成员管理，区分 owner/editor/viewer。
- 告警中心：Schema 错误率、事件量突降、关键转化异常。
- 接入 OpenTelemetry Dashboard，统一展示 collector/consumer/api 延迟、吞吐和 DLQ。
- 补 iOS/Web SDK，并统一 SDK 发布、版本兼容矩阵和示例应用。
