package dev.aerolog.sdk

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Bundle
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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
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
    private const val SDK_VERSION = "0.1.0"

    private lateinit var appCtx: Context
    private lateinit var cfg: AeroConfig
    private lateinit var db: EventDatabase
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val buffer = CopyOnWriteArrayList<JSONObject>()
    private val superProps = mutableMapOf<String, Any?>()
    private var anonId: String = ""
    private var userId: String? = null
    private var sessionId: String = UUID.randomUUID().toString()

    private val http = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    fun init(app: Application, config: AeroConfig) {
        appCtx = app.applicationContext
        cfg = config
        db = Room.databaseBuilder(appCtx, EventDatabase::class.java, "aerolog.db").build()

        val sp = appCtx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        anonId = sp.getString(KEY_ANON, null) ?: ("anon_" + UUID.randomUUID().toString()).also {
            sp.edit().putString(KEY_ANON, it).apply()
        }
        userId = sp.getString(KEY_USER, null)

        if (cfg.autoTrackAppLifecycle) attachAppLifecycle()
        if (cfg.autoTrackActivity) attachActivityCallback(app)

        // 周期 flush
        scope.launch {
            while (true) {
                kotlinx.coroutines.delay(cfg.flushIntervalMs)
                runCatching { flush() }
            }
        }
    }

    fun track(event: String, properties: Map<String, Any?>? = null) =
        enqueue("track", event, properties)

    fun identify(uid: String) {
        val prev = userId
        userId = uid
        appCtx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putString(KEY_USER, uid).apply()
        if (prev == null) {
            track("\$SignUp", mapOf("\$anonymous_id" to anonId))
        }
    }

    fun logout() {
        userId = null
        appCtx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().remove(KEY_USER).apply()
    }

    fun setProfile(props: Map<String, Any?>) = enqueue("profile_set", "", props)

    fun registerSuperProperties(props: Map<String, Any?>) {
        superProps.putAll(props)
    }

    /** 立即上报缓冲与持久化中的事件 */
    suspend fun flush() {
        // 1. 内存缓冲
        if (buffer.isNotEmpty()) {
            val batch = ArrayList(buffer); buffer.clear()
            if (!send(batch.map { it.toString() })) {
                batch.forEach { storeOne(it.toString()) }
            }
        }
        // 2. 持久化
        while (true) {
            val items = db.events().take(cfg.batchSize)
            if (items.isEmpty()) break
            val ok = send(items.map { it.payload })
            if (ok) db.events().delete(items.map { it.id })
            else break
        }
    }

    // ==== 内部 ====

    private fun enqueue(type: String, event: String, properties: Map<String, Any?>?) {
        if (!::cfg.isInitialized) error("AeroLog.init() not called")
        val distinctId = userId ?: anonId
        val props = JSONObject().apply {
            put("\$insert_id", UUID.randomUUID().toString())
            put("\$session_id", sessionId)
            collectAutoProps(this)
            for ((k, v) in superProps) put(k, v)
            properties?.forEach { (k, v) -> put(k, v) }
        }
        val ev = JSONObject().apply {
            put("type", type)
            put("event", event)
            put("distinct_id", distinctId)
            put("anonymous_id", anonId)
            userId?.let { put("user_id", it) }
            put("time", System.currentTimeMillis())
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
        val req = Request.Builder()
            .url("${cfg.serverUrl.trimEnd('/')}/v1/track?token=${cfg.token}")
            .header("X-AeroLog-SDK", "android/$SDK_VERSION")
            .post(arr.toString().toRequestBody("application/json".toMediaType()))
            .build()
        return runCatching {
            http.newCall(req).execute().use { resp ->
                // 4xx 非 429 视为服务端拒绝，不再重试
                resp.isSuccessful || (resp.code in 400..499 && resp.code != 429)
            }
        }.getOrDefault(false)
    }

    private fun attachAppLifecycle() {
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) { track("\$AppStart") }
            override fun onStop(owner: LifecycleOwner) {
                track("\$AppEnd")
                scope.launch { runCatching { flush() } }
            }
        })
    }

    private fun attachActivityCallback(app: Application) {
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityResumed(a: Activity) {
                track("\$AppViewScreen", mapOf("\$screen_name" to a.javaClass.simpleName))
            }
            override fun onActivityCreated(a: Activity, b: Bundle?) {}
            override fun onActivityStarted(a: Activity) {}
            override fun onActivityPaused(a: Activity) {}
            override fun onActivityStopped(a: Activity) {}
            override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
            override fun onActivityDestroyed(a: Activity) {}
        })
    }
}
