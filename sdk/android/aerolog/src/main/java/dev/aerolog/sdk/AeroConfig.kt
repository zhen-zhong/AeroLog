package dev.aerolog.sdk

/**
 * AeroLog Android SDK 配置。
 *
 * @property serverUrl Collector 服务地址，例如 https://collector.example.com 或 http://10.0.2.2:8081。
 * @property token 项目 token，可在 AeroLog 控制台项目管理中获取。
 * @property secret 项目 HMAC 签名密钥；为空表示不开启签名（与服务端默认放行行为一致）。
 *                  建议从安全配置/远端下发，不要硬编码到 APK 中。
 * @property batchSize 内存/本地缓存批量上报阈值，SDK 会归一到 1..500。
 * @property flushIntervalMs 周期上报间隔，最小 1000ms。
 * @property storageLimit 离线缓存最大事件数，最小 100。
 * @property autoTrackAppLifecycle 是否自动采集 $AppStart / $AppEnd。
 * @property autoTrackActivity 是否自动采集 Activity 页面浏览 $AppViewScreen。
 * @property debug 是否输出 SDK 调试日志。
 */
data class AeroConfig(
    val serverUrl: String,
    val token: String,
    val secret: String = "",
    val batchSize: Int = 50,
    val flushIntervalMs: Long = 5_000L,
    val storageLimit: Int = 10_000,
    val autoTrackAppLifecycle: Boolean = true,
    val autoTrackActivity: Boolean = true,
    val debug: Boolean = false,
)
