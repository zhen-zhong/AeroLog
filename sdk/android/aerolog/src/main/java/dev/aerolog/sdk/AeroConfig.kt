package dev.aerolog.sdk

/**
 * AeroLog 配置
 */
data class AeroConfig(
    val serverUrl: String,
    val token: String,
    val batchSize: Int = 50,
    val flushIntervalMs: Long = 5_000L,
    val storageLimit: Int = 10_000,
    val autoTrackAppLifecycle: Boolean = true,
    val autoTrackActivity: Boolean = true,
    val debug: Boolean = false,
)
