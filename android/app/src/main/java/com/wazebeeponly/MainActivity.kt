package com.wazebeeponly

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        webView.settings.apply {
            javaScriptEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
        }
        webView.addJavascriptInterface(AndroidBridge(), "Android")
        webView.loadUrl("file:///android_asset/index.html")

        // Request full storage permission if not granted
        if (!Environment.isExternalStorageManager()) {
            val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
            intent.data = Uri.parse("package:$packageName")
            startActivity(intent)
        }
    }

    inner class AndroidBridge {
        @JavascriptInterface
        fun installVoicePack(configJson: String) {
            Thread {
                try {
                    if (!Environment.isExternalStorageManager()) {
                        runOnUiThread {
                            webView.evaluateJavascript(
                                "onInstallError('נדרשת הרשאת גישה לאחסון. אשר אותה בהגדרות ונסה שוב.')", null
                            )
                        }
                        return@Thread
                    }
                    installFiles(configJson)
                    runOnUiThread { webView.evaluateJavascript("onInstallSuccess()", null) }
                } catch (e: Exception) {
                    val msg = e.message?.replace("'", "\\'") ?: "שגיאה לא ידועה"
                    runOnUiThread { webView.evaluateJavascript("onInstallError('$msg')", null) }
                }
            }.start()
        }
    }

    // ── File installation ──────────────────────────────────────────

    private fun installFiles(configJson: String) {
        val config = JSONObject(configJson)

        val soundDir = File(Environment.getExternalStorageDirectory(), "waze/sound")
        if (!soundDir.exists()) soundDir.mkdirs()

        val beepOnlyDir = File(soundDir, "beep_only")
        if (beepOnlyDir.exists()) beepOnlyDir.deleteRecursively()
        beepOnlyDir.mkdirs()

        val silenceBytes = generateSilence()
        val beep1Bytes   = generateBeep(1)
        val beep2Bytes   = generateBeep(2)

        for (filename in ALL_FILES) {
            val bytes = when (config.optString(filename, "silent")) {
                "beep1" -> beep1Bytes
                "beep2" -> beep2Bytes
                else    -> silenceBytes
            }
            File(beepOnlyDir, "$filename.mp3").writeBytes(bytes)
        }
    }

    // ── Audio generation ───────────────────────────────────────────

    private fun makeWav(samples: ShortArray, sampleRate: Int = 8000): ByteArray {
        val dataSize = samples.size * 2
        val buf = ByteBuffer.allocate(44 + dataSize).order(ByteOrder.LITTLE_ENDIAN)
        buf.put("RIFF".toByteArray(Charsets.US_ASCII))
        buf.putInt(36 + dataSize)
        buf.put("WAVE".toByteArray(Charsets.US_ASCII))
        buf.put("fmt ".toByteArray(Charsets.US_ASCII))
        buf.putInt(16)
        buf.putShort(1); buf.putShort(1)
        buf.putInt(sampleRate); buf.putInt(sampleRate * 2)
        buf.putShort(2); buf.putShort(16)
        buf.put("data".toByteArray(Charsets.US_ASCII))
        buf.putInt(dataSize)
        samples.forEach { buf.putShort(it) }
        return buf.array()
    }

    private fun generateSilence() =
        makeWav(ShortArray((8000 * 0.05).toInt()))

    private fun generateBeep(count: Int): ByteArray {
        val sr    = 8000
        val beepN = (sr * 0.14).toInt()
        val gapN  = (sr * 0.11).toInt()
        val fade  = (sr * 0.012).toInt()
        val freq  = 880.0
        val total = beepN * count + gapN * (count - 1)
        val s     = ShortArray(total)
        for (b in 0 until count) {
            val off = b * (beepN + gapN)
            for (i in 0 until beepN) {
                val t   = i.toDouble() / sr
                val env = minOf(i.toDouble() / fade, 1.0) *
                          minOf((beepN - i).toDouble() / fade, 1.0)
                s[off + i] = (env * 13000 * sin(2 * PI * freq * t)).toInt().toShort()
            }
        }
        return makeWav(s)
    }

    companion object {
        val ALL_FILES = listOf(
            "TurnLeft", "TurnRight", "KeepLeft", "KeepRight", "Straight",
            "ExitLeft", "ExitRight", "Exit", "uturn", "Roundabout",
            "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "AndThen",
            "200", "400", "800", "1500",
            "200meters", "400meters", "800meters", "1000meters", "1500meters",
            "ft", "m", "within",
            "StartDrive1", "StartDrive2", "StartDrive3", "StartDrive4", "StartDrive5",
            "StartDrive6", "StartDrive7", "StartDrive8", "StartDrive9", "Arrive",
            "ApproachAccident", "ApproachHazard", "ApproachRedLightCam",
            "ApproachSpeedCam", "ApproachTraffic", "Police",
            "click", "click_long", "ping", "ping2", "TickerPoints",
            "message_ticker", "alert_1", "bonus", "reminder", "rec_start", "rec_end"
        )
    }
}
