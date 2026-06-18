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
 * @property autoTrackActivityDuration 是否在 onPause 自动追加 $AppViewScreenEnd 并附带 $screen_duration。
 * @property autoTrackCrash 是否捕获未处理异常并上报 $AppCrash（仅记录一次后转发给原 handler）。
 * @property autoTrackANR 是否在主线程检测 ANR（5 秒未响应）并上报 $AppANR。
 * @property autoTrackInstall 是否自动上报 $AppInstall / $AppUpdate（基于 SharedPreferences 缓存的 versionName）。
 * @property enableGzip 是否对上报包体启用 gzip 压缩；与服务端 collector.handler 解压逻辑兼容。
 * @property debug 是否输出 SDK 调试日志（通过 logcat）。
 * @property enableLocalDebugLog 是否在内存维护一份 DebugView 本地日志环形缓冲，便于自测/排障。
 * @property debugLogCapacity 本地日志环形缓冲最大条数（默认 200，最小 50，最大 2000）。
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
    val autoTrackActivityDuration: Boolean = true,
    val autoTrackCrash: Boolean = true,
    val autoTrackANR: Boolean = false,
    val autoTrackInstall: Boolean = true,
    val enableGzip: Boolean = true,
    val debug: Boolean = false,
    val enableLocalDebugLog: Boolean = false,
    val debugLogCapacity: Int = 200,
)
