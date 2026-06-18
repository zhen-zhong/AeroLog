package dev.aerolog.sample

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import dev.aerolog.sdk.AeroLog

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val title = TextView(this).apply {
            text = "AeroLog Android Sample"
            textSize = 20f
        }
        val eventButton = Button(this).apply {
            text = "Track custom event"
            setOnClickListener {
                AeroLog.track(
                    "sample_button_click",
                    mapOf(
                        "button_name" to "track_custom_event",
                        "screen" to "main",
                        "debug_log_count" to AeroLog.getDebugLogs().size,
                    ),
                )
            }
        }
        val flushButton = Button(this).apply {
            text = "Flush"
            setOnClickListener { AeroLog.flushAsync() }
        }

        setContentView(
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(48, 48, 48, 48)
                addView(title)
                addView(eventButton)
                addView(flushButton)
            },
        )
    }
}
