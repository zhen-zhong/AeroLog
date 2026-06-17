package dev.aerolog.sdk

import android.app.Activity
import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
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
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.Date
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * AeroLog Android SDK 入口。
 *
 * 用法：
 * ```kotlin
 * AeroLog.init(application, AeroConfig("https://collector.aerolog.example", "TOKEN"))
 * AeroLog.track("button_click", mapOf("btn" to "checkout"))
 * ```
 */
object AeroLog {
    private const val PREF = "aerolog_prefs"
    private const val KEY_ANON = "anon_id"
    private const val KEY_USER = "user_id"
    private const val SDK_NAME = "android"
    private val SDK_VERSION = BuildConfig.SDK_VERSION
    private const val TAG = "AeroLog"

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
        val req = Request.Builder()
            .url("${cfg.serverUrl.trimEnd('/')}/v1/track?token=$encodedToken")
            .header("X-AeroLog-SDK", "android/$SDK_VERSION")
            .post(arr.toString().toRequestBody("application/json".toMediaType()))
            .build()
        return runCatching {
            http.newCall(req).execute().use { resp ->
                // 4xx 非 429 视为服务端拒绝，不再重试
                resp.isSuccessful || (resp.code in 400..499 && resp.code != 429)
            }
        }.onFailure { logDebug("flush failed: ${it.message}") }.getOrDefault(false)
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
                track("\$AppViewScreen", mapOf(
                    "\$screen_name" to a.javaClass.simpleName,
                    "\$screen_title" to (a.title?.toString() ?: ""),
                ))
            }
            override fun onActivityCreated(a: Activity, b: Bundle?) {}
            override fun onActivityStarted(a: Activity) {}
            override fun onActivityPaused(a: Activity) {}
            override fun onActivityStopped(a: Activity) {}
            override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
            override fun onActivityDestroyed(a: Activity) {}
        })
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
