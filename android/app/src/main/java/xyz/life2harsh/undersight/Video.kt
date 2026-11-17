package xyz.life2harsh.undersight

import android.media.MediaCodec
import android.media.MediaFormat
import android.view.Surface
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.net.HttpURLConnection
import java.net.URL

class Video(private val surface: Surface, private val url: () -> String, private val live: (Boolean) -> Unit) : Thread() {
    @Volatile private var on = true
    @Volatile private var conn: HttpURLConnection? = null

    init { isDaemon = true }

    fun close() {
        on = false
        conn?.disconnect()
        interrupt()
    }

    override fun run() {
        while (on) {
            try { stream() } catch (e: Exception) { live(false) }
            if (on) try { sleep(1500) } catch (e: InterruptedException) {}
        }
    }

    private fun stream() {
        val c = (URL(url()).openConnection() as HttpURLConnection).apply { connectTimeout = 2000; readTimeout = 6000 }
        conn = c
        val s = DataInputStream(BufferedInputStream(c.inputStream, 1 shl 16))
        val codec = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        val fmt = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, 640, 480)
        if (android.os.Build.VERSION.SDK_INT >= 30) fmt.setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
        codec.configure(fmt, surface, null, 0)
        codec.start()
        val info = MediaCodec.BufferInfo()
        var buf = ByteArray(1 shl 16)
        try {
            while (on) {
                val pf = s.readLong()
                val n = s.readInt()
                if (n > buf.size) buf = ByteArray(n)
                s.readFully(buf, 0, n)
                val cfg = (pf ushr 62) and 1L == 1L
                val i = codec.dequeueInputBuffer(50_000)
                if (i >= 0) {
                    codec.getInputBuffer(i)!!.apply { clear(); put(buf, 0, n) }
                    codec.queueInputBuffer(i, 0, n, pf and 0x1FFFFFFFFFFFFFFFL, if (cfg) MediaCodec.BUFFER_FLAG_CODEC_CONFIG else 0)
                }
                while (true) {
                    val o = codec.dequeueOutputBuffer(info, 0)
                    if (o < 0) break
                    codec.releaseOutputBuffer(o, true)
                    live(true)
                }
            }
        } finally {
            codec.stop()
            codec.release()
            c.disconnect()
        }
    }
}
