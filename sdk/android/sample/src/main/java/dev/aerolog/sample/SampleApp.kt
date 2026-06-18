package dev.aerolog.sample

import android.app.Application
import dev.aerolog.sdk.AeroConfig
import dev.aerolog.sdk.AeroLog

class SampleApp : Application() {
    override fun onCreate() {
        super.onCreate()
        AeroLog.init(
            this,
            AeroConfig(
                serverUrl = BuildConfig.AEROLOG_SERVER_URL,
                token = BuildConfig.AEROLOG_TOKEN,
                secret = BuildConfig.AEROLOG_SECRET,
                debug = BuildConfig.DEBUG,
                enableLocalDebugLog = BuildConfig.DEBUG,
                autoTrackANR = false,
            ),
        )
        AeroLog.registerSuperProperties(
            mapOf(
                "sample_app" to true,
                "sample_version" to BuildConfig.VERSION_NAME,
            ),
        )
    }
}
