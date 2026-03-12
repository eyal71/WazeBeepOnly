package com.wazebeeponly

import android.net.Uri
import android.os.Bundle
import android.webkit.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.documentfile.provider.DocumentFile
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var pendingConfig: String? = null

    private val folderPicker = registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri ->
        val config = pendingConfig ?: return@registerForActivityResult
        if (uri == null) {
            runOnUiThread { webView.evaluateJavascript("onInstallCancel()", null) }
            return@registerForActivityResult
        }
        contentResolver.takePersistableUriPermission(
            uri,
            android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or
            android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
        Thread {
            try {
                installFiles(uri, config)
                runOnUiThread { webView.evaluateJavascript("onInstallSuccess()", null) }
            } catch (e: Exception) {
                val msg = e.message?.replace("'", "\\'") ?: "שגיאה לא ידועה"
                runOnUiThread { webView.evaluateJavascript("onInstallError('$msg')", null) }
            }
        }.start()
    }

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
    }

    inner class AndroidBridge {
        @JavascriptInterface
        fun installVoicePack(configJson: String) {
            pendingConfig = configJson
            runOnUiThread {
                // Try to open directly at the waze/sound folder
                val hint = Uri.parse(
                    "content://com.android.externalstorage.documents/tree/primary%3Awaze%2Fsound"
                )
                folderPicker.launch(hint)
            }
        }
    }

    // ── File installation ──────────────────────────────────────────

    private fun installFiles(treeUri: Uri, configJson: String) {
        val config  = JSONObject(configJson)
        val treeDoc = DocumentFile.fromTreeUri(this, treeUri)
            ?: throw Exception("לא ניתן לפתוח את התיקייה שנבחרה")

        // Resolve the right parent: user may select waze/, waze/sound/, or anywhere else
        val soundDir = when (treeDoc.name) {
            "sound" -> treeDoc
            "waze"  -> treeDoc.findFile("sound")
                ?: treeDoc.createDirectory("sound")
                ?: throw Exception("לא ניתן ליצור תיקיית sound")
            else    -> treeDoc
        }

        // Get or create beep_only/
        val beepOnlyDir = soundDir.findFile("beep_only")?.also { dir ->
            dir.listFiles().forEach { it.delete() }
        } ?: soundDir.createDirectory("beep_only")
            ?: throw Exception("לא ניתן ליצור תיקיית beep_only")

        val silenceBytes = generateSilence()
        val beep1Bytes   = generateBeep(1)
        val beep2Bytes   = generateBeep(2)

        for (filename in ALL_FILES) {
            val bytes = when (config.optString(filename, "silent")) {
                "beep1" -> beep1Bytes
                "beep2" -> beep2Bytes
                else    -> silenceBytes
            }
            val file = beepOnlyDir.createFile("audio/mpeg", "$filename.mp3") ?: continue
            contentResolver.openOutputStream(file.uri)?.use { it.write(bytes) }
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
        buf.putShort(1)                  // PCM
        buf.putShort(1)                  // mono
        buf.putInt(sampleRate)
        buf.putInt(sampleRate * 2)       // byte rate
        buf.putShort(2)                  // block align
        buf.putShort(16)                 // bits per sample
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
