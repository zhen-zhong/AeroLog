package dev.aerolog.sdk

import android.app.Activity
import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.room.Room
import dev.aerolog.sdk.storage.EventDatabase
import dev.aerolog.sdk.storage.StoredEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.ArrayDeque
import java.util.Date
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPOutputStream
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * AeroLog Android SDK 入口。
 *
 * 用法：
 * ```kotlin
 * // SaaS：默认上报到 https://collector.aerolog.cc
 * AeroLog.init(application, AeroConfig(token = "TOKEN"))
 * // 私有化：覆盖 serverUrl
 * AeroLog.init(application, AeroConfig(token = "TOKEN", serverUrl = "https://collector.your-company.com"))
 * AeroLog.track("button_click", mapOf("btn" to "checkout"))
 * ```
 */
object AeroLog {
    private const val PREF = "aerolog_prefs"
    private const val KEY_ANON = "anon_id"
    private const val KEY_USER = "user_id"
    private const val KEY_INSTALL_VERSION = "install_version"
    private const val KEY_INSTALL_REPORTED = "install_reported"
    private const val KEY_PENDING_CRASHES = "pending_crashes"
    private const val SDK_NAME = "android"
    private val SDK_VERSION = BuildConfig.SDK_VERSION
    private const val TAG = "AeroLog"
    private const val ANR_THRESHOLD_MS = 5_000L
    private const val ANR_COOLDOWN_MS = 60_000L

    private lateinit var appCtx: Context
    private lateinit var cfg: AeroConfig
    private lateinit var db: EventDatabase
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val buffer = CopyOnWriteArrayList<JSONObject>()
    private val superProps = ConcurrentHashMap<String, Any>()
    private var anonId: String = ""
    private var userId: String? = null
    private var sessionId: String = UUID.randomUUID().toString()
    private var appStartAt: Long = 0L
    private var lifecycleAttached = false
    private var activityCallbackAttached = false
    private var flushLoopStarted = false
    private var crashHandlerAttached = false
    private var anrWatcherStarted = false
    private var lastAnrAt = 0L
    private val activityResumedAt = ConcurrentHashMap<String, Long>()
    private val debugLog: ArrayDeque<JSONObject> = ArrayDeque()
    private val debugLogLock = Any()

    private val http = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    fun init(app: Application, config: AeroConfig) {
        appCtx = app.applicationContext
        cfg = normalizeConfig(config)
        db = Room.databaseBuilder(appCtx, EventDatabase::class.java, "aerolog.db").build()

        val sp = appCtx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        anonId = sp.getString(KEY_ANON, null) ?: ("anon_" + UUID.randomUUID().toString()).also {
            sp.edit().putString(KEY_ANON, it).apply()
        }
        userId = sp.getString(KEY_USER, null)

        if (cfg.autoTrackAppLifecycle && !lifecycleAttached) attachAppLifecycle()
        if (cfg.autoTrackActivity && !activityCallbackAttached) attachActivityCallback(app)
        if (cfg.autoTrackCrash && !crashHandlerAttached) attachCrashHandler()
        if (cfg.autoTrackANR && !anrWatcherStarted) attachAnrWatcher()
        if (cfg.autoTrackInstall) reportInstallOrUpdate()
        replayPendingCrashes()

        if (!flushLoopStarted) {
            flushLoopStarted = true
            scope.launch {
                while (true) {
                    kotlinx.coroutines.delay(cfg.flushIntervalMs)
                    runCatching { flush() }
                }
            }
        }
    }

    /**
     * 上报自定义事件。
     *
     * event 为事件名，最长 128 字符；properties 为自定义参数，会与自动采集属性、公共属性合并。
     * 支持 String / Number / Boolean / Map / Iterable / Array / JSONObject / JSONArray / Date 等常见类型。
     */
    fun track(
        event: String,
        properties: Map<String, Any?>? = null,
        time: Long = System.currentTimeMillis(),
    ) = enqueue("track", event, properties, time)

    /** Kotlin 友好的自定义参数写法：AeroLog.track("pay_success", "amount" to 99.0)。 */
    fun track(event: String, vararg properties: Pair<String, Any?>) =
        track(event, properties.toMap())

    /** 登录或绑定业务用户 ID。首次绑定会自动上报 $SignUp，用于 anonymous_id 与 user_id 合并。 */
    fun identify(uid: String) {
        require(uid.isNotBlank()) { "user id must not be blank" }
        require(uid.length <= 255) { "user id length must be <= 255" }
        val prev = userId
        userId = uid
        appCtx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putString(KEY_USER, uid).apply()
        if (prev == null) {
            track("\$SignUp", mapOf("\$anonymous_id" to anonId))
        }
    }

    /** identify 的别名，便于业务侧按登录语义接入。 */
    fun login(uid: String) = identify(uid)

    fun logout() {
        userId = null
        appCtx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().remove(KEY_USER).apply()
    }

    fun setProfile(props: Map<String, Any?>) = enqueue("profile_set", "", props)

    fun setProfileOnce(props: Map<String, Any?>) = enqueue("profile_set_once", "", props)

    fun incrementProfile(props: Map<String, Number>) = enqueue("profile_increment", "", props)

    fun unsetProfile(vararg keys: String) =
        enqueue("profile_unset", "", keys.associateWith { true })

    fun deleteProfile() = enqueue("profile_delete", "", emptyMap())

    /** 注册公共属性：之后所有事件都会携带，业务属性同名时会覆盖公共属性。 */
    fun registerSuperProperties(props: Map<String, Any?>) {
        for ((key, value) in props) {
            if (isValidPropertyName(key)) {
                val jsonValue = toJsonValue(value)
                if (jsonValue !== SkipJsonValue) {
                    superProps[key] = jsonValue
                }
            } else {
                logDebug("skip invalid super property: $key")
            }
        }
    }

    fun unregisterSuperProperty(key: String) {
        superProps.remove(key)
    }

    fun clearSuperProperties() {
        superProps.clear()
    }

    fun getAnonymousId(): String {
        ensureInitialized()
        return anonId
    }

    fun getUserId(): String? {
        ensureInitialized()
        return userId
    }

    /** 非协程场景手动触发 flush。 */
    fun flushAsync(onComplete: ((Boolean) -> Unit)? = null) {
        ensureInitialized()
        scope.launch {
            val ok = runCatching { flush() }.getOrDefault(false)
            onComplete?.let { callback ->
                withContext(Dispatchers.Main) { callback(ok) }
            }
        }
    }

    /** 立即上报缓冲与持久化中的事件 */
    suspend fun flush(): Boolean {
        ensureInitialized()
        var success = true
        // 1. 内存缓冲
        if (buffer.isNotEmpty()) {
            val batch = ArrayList(buffer); buffer.clear()
            if (!send(batch.map { it.toString() })) {
                batch.forEach { storeOne(it.toString()) }
                success = false
            }
        }
        // 2. 持久化
        while (true) {
            val items = db.events().take(cfg.batchSize)
            if (items.isEmpty()) break
            val ok = send(items.map { it.payload })
            if (ok) db.events().delete(items.map { it.id })
            else {
                success = false
                break
            }
        }
        return success
    }

    // ==== 内部 ====

    private fun enqueue(
        type: String,
        event: String,
        properties: Map<String, Any?>?,
        time: Long = System.currentTimeMillis(),
    ) {
        ensureInitialized()
        if (type == "track") validateEventName(event)
        val distinctId = userId ?: anonId
        val props = JSONObject().apply {
            put("\$insert_id", UUID.randomUUID().toString())
            put("\$session_id", sessionId)
            collectAutoProps(this)
            for ((k, v) in superProps) putSanitized(k, v)
            properties?.forEach { (k, v) -> putSanitized(k, v) }
        }
        val ev = JSONObject().apply {
            put("type", type)
            put("event", event)
            put("distinct_id", distinctId)
            put("anonymous_id", anonId)
            userId?.let { put("user_id", it) }
            put("time", time)
            put("lib", JSONObject(mapOf("name" to SDK_NAME, "version" to SDK_VERSION)))
            put("properties", props)
        }
        buffer.add(ev)
        recordDebugLog(ev)
        if (buffer.size >= cfg.batchSize) {
            scope.launch { runCatching { flush() } }
        }
    }

    private fun collectAutoProps(o: JSONObject) {
        o.put("\$lib", SDK_NAME)
        o.put("\$lib_version", SDK_VERSION)
        o.put("\$os", "Android")
        o.put("\$os_version", Build.VERSION.RELEASE ?: "")
        o.put("\$model", Build.MODEL ?: "")
        o.put("\$manufacturer", Build.MANUFACTURER ?: "")
        o.put("\$network_type", networkType())
        val dm = appCtx.resources.displayMetrics
        o.put("\$screen_width", dm.widthPixels)
        o.put("\$screen_height", dm.heightPixels)
        try {
            val pi = appCtx.packageManager.getPackageInfo(appCtx.packageName, 0)
            o.put("\$app_version", pi.versionName ?: "")
        } catch (_: Throwable) { /* ignore */ }
    }

    private suspend fun storeOne(payload: String) {
        val cnt = db.events().count()
        if (cnt >= cfg.storageLimit) {
            db.events().trimOldest(cnt - cfg.storageLimit + 1)
        }
        db.events().insert(StoredEvent(payload = payload, createdAt = System.currentTimeMillis()))
    }

    private fun send(items: List<String>): Boolean {
        if (items.isEmpty()) return true
        val arr = JSONArray()
        items.forEach { arr.put(JSONObject(it)) }
        val encodedToken = URLEncoder.encode(cfg.token, StandardCharsets.UTF_8.name())
        val rawBytes = arr.toString().toByteArray(StandardCharsets.UTF_8)
        // 服务端 collector 会在校验签名前先 gunzip，因此 gzip 仅是传输层。
        val signature = hmacSha256Hex(cfg.secret, rawBytes)
        val gzipped = cfg.enableGzip && rawBytes.size >= 1024
        val bodyBytes = if (gzipped) gzip(rawBytes) else rawBytes
        val builder = Request.Builder()
            .url("${cfg.serverUrl.trimEnd('/')}/v1/track?token=$encodedToken")
            .header("X-AeroLog-SDK", "android/$SDK_VERSION")
            .post(bodyBytes.toRequestBody("application/json".toMediaType()))
        if (gzipped) {
            builder.header("Content-Encoding", "gzip")
        }
        if (signature != null) {
            builder.header("X-AeroLog-Signature", "sha256=$signature")
        }
        val req = builder.build()
        return runCatching {
            http.newCall(req).execute().use { resp ->
                if (resp.isSuccessful) return@use true
                val responseText = resp.body?.string().orEmpty()
                if (resp.code in 400..499 && resp.code != 429) {
                    recordDebugStatus(
                        "collector rejected batch",
                        mapOf("status" to resp.code, "body" to responseText.take(1_000), "items" to items.size),
                    )
                    logDebug("collector rejected batch: ${resp.code} ${responseText.take(200)}")
                    return@use true
                }
                recordDebugStatus(
                    "collector send failed",
                    mapOf("status" to resp.code, "body" to responseText.take(1_000), "items" to items.size),
                )
                false
            }
        }.onFailure { logDebug("flush failed: ${it.message}") }.getOrDefault(false)
    }

    private fun gzip(raw: ByteArray): ByteArray {
        val baos = ByteArrayOutputStream(raw.size / 2 + 32)
        GZIPOutputStream(baos).use { it.write(raw) }
        return baos.toByteArray()
    }

    /** 用项目 secret 对请求体计算 HMAC-SHA256；secret 为空时返回 null（不附带签名头）。 */
    private fun hmacSha256Hex(secret: String, body: ByteArray): String? {
        if (secret.isEmpty()) return null
        return runCatching {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(secret.toByteArray(StandardCharsets.UTF_8), "HmacSHA256"))
            val raw = mac.doFinal(body)
            val sb = StringBuilder(raw.size * 2)
            for (b in raw) {
                sb.append(String.format("%02x", b.toInt() and 0xFF))
            }
            sb.toString()
        }.onFailure { logDebug("hmac sign failed: ${it.message}") }.getOrNull()
    }

    private fun attachAppLifecycle() {
        lifecycleAttached = true
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                sessionId = UUID.randomUUID().toString()
                appStartAt = System.currentTimeMillis()
                track("\$AppStart")
            }
            override fun onStop(owner: LifecycleOwner) {
                val duration = if (appStartAt > 0) System.currentTimeMillis() - appStartAt else 0L
                track("\$AppEnd", mapOf("\$event_duration" to duration))
                scope.launch { runCatching { flush() } }
            }
        })
    }

    private fun attachActivityCallback(app: Application) {
        activityCallbackAttached = true
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityResumed(a: Activity) {
                if (cfg.autoTrackActivityDuration) {
                    activityResumedAt[a.javaClass.name] = SystemClock.elapsedRealtime()
                }
                track("\$AppViewScreen", mapOf(
                    "\$screen_name" to a.javaClass.simpleName,
                    "\$screen_title" to (a.title?.toString() ?: ""),
                ))
            }
            override fun onActivityPaused(a: Activity) {
                if (!cfg.autoTrackActivityDuration) return
                val start = activityResumedAt.remove(a.javaClass.name) ?: return
                val duration = SystemClock.elapsedRealtime() - start
                if (duration <= 0) return
                track("\$AppViewScreenEnd", mapOf(
                    "\$screen_name" to a.javaClass.simpleName,
                    "\$screen_title" to (a.title?.toString() ?: ""),
                    "\$screen_duration" to duration,
                ))
            }
            override fun onActivityCreated(a: Activity, b: Bundle?) {}
            override fun onActivityStarted(a: Activity) {}
            override fun onActivityStopped(a: Activity) {}
            override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
            override fun onActivityDestroyed(a: Activity) {}
        })
    }

    private fun attachCrashHandler() {
        crashHandlerAttached = true
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching {
                val stack = StringBuilder()
                throwable.stackTrace.take(40).forEach { stack.append(it.toString()).append('\n') }
                val ev = JSONObject().apply {
                    put("type", "track")
                    put("event", "\$AppCrash")
                    val distinctId = userId ?: anonId
                    put("distinct_id", distinctId)
                    put("anonymous_id", anonId)
                    userId?.let { put("user_id", it) }
                    put("time", System.currentTimeMillis())
                    put("lib", JSONObject(mapOf("name" to SDK_NAME, "version" to SDK_VERSION)))
                    put("properties", JSONObject().apply {
                        put("\$insert_id", UUID.randomUUID().toString())
                        put("\$session_id", sessionId)
                        collectAutoProps(this)
                        put("\$crash_thread", thread.name)
                        put("\$crash_type", throwable.javaClass.name)
                        put("\$crash_message", throwable.message ?: "")
                        put("\$crash_stack", stack.toString())
                    })
                }
                buffer.add(ev)
                recordDebugLog(ev)
                persistCrashEvent(ev.toString())
            }
            previous?.uncaughtException(thread, throwable)
        }
    }

    private fun attachAnrWatcher() {
        anrWatcherStarted = true
        scope.launch {
            val main = Handler(Looper.getMainLooper())
            while (true) {
                kotlinx.coroutines.delay(ANR_THRESHOLD_MS)
                val tick = System.currentTimeMillis()
                val ping = java.util.concurrent.atomic.AtomicBoolean(false)
                main.post { ping.set(true) }
                kotlinx.coroutines.delay(ANR_THRESHOLD_MS)
                val now = System.currentTimeMillis()
                if (!ping.get() && ::cfg.isInitialized && now - lastAnrAt >= ANR_COOLDOWN_MS) {
                    lastAnrAt = now
                    val blockedFor = now - tick
                    val mainStack = Looper.getMainLooper().thread.stackTrace
                        .take(40)
                        .joinToString("\n") { it.toString() }
                    runCatching {
                        track("\$AppANR", mapOf(
                            "\$blocked_ms" to blockedFor,
                            "\$main_thread" to (Looper.getMainLooper().thread.name),
                            "\$main_stack" to mainStack,
                        ))
                    }
                }
            }
        }
    }

    private fun persistCrashEvent(payload: String) {
        runCatching {
            val sp = appCtx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            val arr = JSONArray(sp.getString(KEY_PENDING_CRASHES, "[]"))
            arr.put(payload)
            while (arr.length() > 10) {
                arr.remove(0)
            }
            sp.edit().putString(KEY_PENDING_CRASHES, arr.toString()).commit()
        }.onFailure { logDebug("persist crash failed: ${it.message}") }
    }

    private fun replayPendingCrashes() {
        runCatching {
            val sp = appCtx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            val raw = sp.getString(KEY_PENDING_CRASHES, "[]") ?: "[]"
            val arr = JSONArray(raw)
            if (arr.length() == 0) return
            for (i in 0 until arr.length()) {
                val payload = arr.optString(i)
                if (payload.isNotBlank()) {
                    buffer.add(JSONObject(payload))
                }
            }
            sp.edit().remove(KEY_PENDING_CRASHES).apply()
            scope.launch { runCatching { flush() } }
        }.onFailure { logDebug("replay crash failed: ${it.message}") }
    }

    private fun reportInstallOrUpdate() {
        runCatching {
            val sp = appCtx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            val current = appCtx.packageManager.getPackageInfo(appCtx.packageName, 0).versionName ?: ""
            val previous = sp.getString(KEY_INSTALL_VERSION, null)
            val reported = sp.getBoolean(KEY_INSTALL_REPORTED, false)
            when {
                !reported -> {
                    track("\$AppInstall", mapOf("\$app_version" to current))
                    sp.edit().putString(KEY_INSTALL_VERSION, current).putBoolean(KEY_INSTALL_REPORTED, true).apply()
                }
                previous != null && previous != current -> {
                    track("\$AppUpdate", mapOf(
                        "\$app_version" to current,
                        "\$prev_app_version" to previous,
                    ))
                    sp.edit().putString(KEY_INSTALL_VERSION, current).apply()
                }
            }
        }
    }

    private fun recordDebugLog(ev: JSONObject) {
        if (!::cfg.isInitialized || !cfg.enableLocalDebugLog) return
        synchronized(debugLogLock) {
            debugLog.addLast(ev)
            val cap = cfg.debugLogCapacity.coerceIn(50, 2_000)
            while (debugLog.size > cap) {
                debugLog.pollFirst()
            }
        }
    }

    private fun recordDebugStatus(message: String, data: Map<String, Any?>) {
        if (!::cfg.isInitialized || !cfg.enableLocalDebugLog) return
        val item = JSONObject().apply {
            put("type", "sdk_debug")
            put("event", "\$SDKSendStatus")
            put("time", System.currentTimeMillis())
            put("message", message)
            put("properties", JSONObject().apply {
                data.forEach { (key, value) -> putSanitized(key, value) }
            })
        }
        recordDebugLog(item)
    }

    /** 读取本地 DebugView 日志（环形缓冲），仅在开启 enableLocalDebugLog 时有数据。 */
    fun getDebugLogs(): List<JSONObject> {
        synchronized(debugLogLock) {
            return ArrayList(debugLog)
        }
    }

    /** 清空本地 DebugView 日志环形缓冲。 */
    fun clearDebugLogs() {
        synchronized(debugLogLock) { debugLog.clear() }
    }

    private fun ensureInitialized() {
        if (!::cfg.isInitialized) error("AeroLog.init() not called")
    }

    private fun normalizeConfig(config: AeroConfig): AeroConfig {
        require(config.serverUrl.isNotBlank()) { "serverUrl must not be blank" }
        require(config.token.isNotBlank()) { "token must not be blank" }
        return config.copy(
            batchSize = config.batchSize.coerceIn(1, 500),
            flushIntervalMs = config.flushIntervalMs.coerceAtLeast(1_000L),
            storageLimit = config.storageLimit.coerceAtLeast(100),
            debugLogCapacity = config.debugLogCapacity.coerceIn(50, 2_000),
        )
    }

    private fun validateEventName(event: String) {
        require(event.isNotBlank()) { "event name must not be blank" }
        require(event.length <= 128) { "event name length must be <= 128" }
    }

    private fun isValidPropertyName(key: String): Boolean =
        key.isNotBlank() && key.length <= 128

    private fun JSONObject.putSanitized(key: String, value: Any?) {
        if (!isValidPropertyName(key)) {
            logDebug("skip invalid property: $key")
            return
        }
        val jsonValue = toJsonValue(value)
        if (jsonValue !== SkipJsonValue) {
            put(key, jsonValue)
        }
    }

    private object SkipJsonValue

    private fun toJsonValue(value: Any?): Any = when (value) {
        null -> JSONObject.NULL
        JSONObject.NULL -> JSONObject.NULL
        is JSONObject -> value
        is JSONArray -> value
        is String -> value
        is Boolean -> value
        is Int, is Long, is Short, is Byte -> value
        is Float -> if (value.isFinite()) value.toDouble() else SkipJsonValue
        is Double -> if (value.isFinite()) value else SkipJsonValue
        is Number -> value
        is Date -> value.time
        is Enum<*> -> value.name
        is Map<*, *> -> {
            val obj = JSONObject()
            value.forEach { (k, v) ->
                val key = k as? String ?: return@forEach
                obj.putSanitized(key, v)
            }
            obj
        }
        is Iterable<*> -> JSONArray().apply {
            value.forEach { item ->
                val jsonValue = toJsonValue(item)
                if (jsonValue !== SkipJsonValue) put(jsonValue)
            }
        }
        is Array<*> -> JSONArray().apply {
            value.forEach { item ->
                val jsonValue = toJsonValue(item)
                if (jsonValue !== SkipJsonValue) put(jsonValue)
            }
        }
        is IntArray -> JSONArray().apply { value.forEach { put(it) } }
        is LongArray -> JSONArray().apply { value.forEach { put(it) } }
        is FloatArray -> JSONArray().apply { value.forEach { if (it.isFinite()) put(it.toDouble()) } }
        is DoubleArray -> JSONArray().apply { value.forEach { if (it.isFinite()) put(it) } }
        is BooleanArray -> JSONArray().apply { value.forEach { put(it) } }
        else -> value.toString()
    }

    private fun networkType(): String {
        return runCatching {
            val cm = appCtx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val network = cm.activeNetwork ?: return@runCatching "unknown"
                val caps = cm.getNetworkCapabilities(network) ?: return@runCatching "unknown"
                when {
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                    else -> "unknown"
                }
            } else {
                @Suppress("DEPRECATION")
                val info = cm.activeNetworkInfo ?: return@runCatching "unknown"
                @Suppress("DEPRECATION")
                if (info.type == ConnectivityManager.TYPE_WIFI) "wifi" else "cellular"
            }
        }.getOrDefault("unknown")
    }

    private fun logDebug(message: String) {
        if (::cfg.isInitialized && cfg.debug) {
            Log.d(TAG, message)
        }
    }
}
