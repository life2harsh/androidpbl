package xyz.life2harsh.undersight

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Gravity
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

class MainActivity : Activity(), SensorEventListener {
    private val ui = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("undersight", Context.MODE_PRIVATE) }
    private val rover by lazy { Rover(prefs.getString("host", "100.94.97.102")!!) }
    private val sm by lazy { getSystemService(SensorManager::class.java) }
    private val vib by lazy { getSystemService(Vibrator::class.java) }

    @Volatile private var jx = 0f
    @Volatile private var jy = 0f
    @Volatile private var stick = false
    @Volatile private var tilting = false
    @Volatile private var brake = false
    @Volatile private var spd = 220
    @Volatile private var alive = false
    private val grav = FloatArray(3)
    private var g0: FloatArray? = null
    private var front = -1
    private var buzzed = 0L
    private var video: Video? = null
    private var recName: String? = null

    private lateinit var dot: View
    private lateinit var status: TextView
    private lateinit var upT: TextView
    private lateinit var frontT: TextView
    private lateinit var compass: Compass
    private lateinit var recB: Button

    private fun dp(v: Int) = (v * resources.displayMetrics.density).roundToInt()
    private fun bg(c: String, r: Int = 14) = GradientDrawable().apply { setColor(Color.parseColor(c)); cornerRadius = dp(r).toFloat() }
    private fun label(s: String, size: Float = 13f) = TextView(this).apply { text = s; textSize = size; setTextColor(Color.parseColor("#E7E9EC")) }
    private fun lp(w: Int, h: Int, weight: Float = 0f) = LinearLayout.LayoutParams(w, h, weight)
    private fun button(s: String) = Button(this).apply {
        text = s; isAllCaps = false; setTextColor(Color.parseColor("#E7E9EC")); background = bg("#1B1F26"); minHeight = dp(44)
    }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        window.decorView.setBackgroundColor(Color.parseColor("#0D0F12"))
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(12), dp(12), dp(12), dp(12))
            addView(videoPane(), lp(0, -1, 1.35f))
            addView(controlPane(), lp(0, -1, 1f).apply { leftMargin = dp(12) })
        })
        thread(isDaemon = true, name = "drive") { driveLoop() }
        thread(isDaemon = true, name = "sense") { senseLoop() }
    }

    private fun videoPane() = FrameLayout(this).apply {
        background = bg("#000000")
        clipToOutline = true
        addView(SurfaceView(context).apply {
            holder.addCallback(object : SurfaceHolder.Callback {
                override fun surfaceCreated(h: SurfaceHolder) {
                    video = Video(h.surface, { "http://${rover.host}:8081/v" }) { ok -> ui.post { if (!ok) status.text = "camera reconnecting" } }.also { it.start() }
                }
                override fun surfaceChanged(h: SurfaceHolder, f: Int, w: Int, ht: Int) {}
                override fun surfaceDestroyed(h: SurfaceHolder) { video?.close(); video = null }
            })
        }, FrameLayout.LayoutParams(-1, -1, Gravity.CENTER))
        addView(LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            background = bg("#990D0F12", 10)
            setPadding(dp(10), dp(6), dp(10), dp(6))
            dot = View(context).apply { background = bg("#F85149", 6) }
            addView(dot, lp(dp(10), dp(10)).apply { rightMargin = dp(8) })
            status = label("connecting", 12f)
            addView(status)
            setOnLongClickListener { askHost(); true }
        }, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.START).apply { setMargins(dp(10), dp(10), 0, 0) })
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun controlPane() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        addView(LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                addView(label("UNDERSIGHT", 11f).apply { setTextColor(Color.parseColor("#8B9099")); letterSpacing = .15f })
                upT = label("↑ -- cm", 20f); addView(upT)
                frontT = label("→ -- cm", 20f); addView(frontT)
            }, lp(0, -2, 1f))
            compass = Compass(context).apply { setOnClickListener { thread { rover.get("/cal") } } }
            addView(compass, lp(dp(84), dp(84)))
        })
        addView(Joystick(context) { x, y, down -> jx = x; jy = y; stick = down }, lp(-1, 0, 1f).apply { setMargins(0, dp(8), 0, dp(8)) })
        addView(LinearLayout(context).apply {
            addView(button("Hold to tilt").apply {
                setOnTouchListener { v, e ->
                    when (e.actionMasked) {
                        MotionEvent.ACTION_DOWN -> { g0 = grav.clone(); tilting = true; v.background = bg("#1F6FEB") }
                        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { tilting = false; jx = 0f; jy = 0f; v.background = bg("#1B1F26") }
                    }
                    true
                }
            }, lp(0, -2, 1.4f))
            recB = button("● REC").apply { setOnClickListener { toggleRec() } }
            addView(recB, lp(0, -2, 1f).apply { leftMargin = dp(8) })
        })
        addView(LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            val v = label("220")
            addView(label("SPD  "))
            addView(SeekBar(context).apply {
                max = 255 - 60; progress = 220 - 60
                setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                    override fun onProgressChanged(s: SeekBar, p: Int, u: Boolean) { spd = p + 60; v.text = "$spd" }
                    override fun onStartTrackingTouch(s: SeekBar) {}
                    override fun onStopTrackingTouch(s: SeekBar) {}
                })
            }, lp(0, -2, 1f))
            addView(v)
        }, lp(-1, -2).apply { topMargin = dp(6) })
    }

    private fun askHost() {
        val e = EditText(this).apply { setText(rover.host); setSingleLine() }
        AlertDialog.Builder(this).setTitle("Rover address").setView(e).setPositiveButton("Save") { _, _ ->
            rover.host = e.text.toString().trim()
            prefs.edit().putString("host", rover.host).apply()
            video?.close()
        }.setNegativeButton("Cancel", null).show()
    }

    private fun toggleRec() = thread {
        val name = recName
        val r = if (name == null) {
            val n = SimpleDateFormat("yyyy-MM-dd-HH-mm-ss", Locale.US).format(Date())
            rover.get("/rec/start/$n", 8081)?.also { recName = n }
        } else rover.get("/rec/stop", 8081)?.also { recName = null }
        ui.post {
            recB.background = bg(if (recName != null) "#DA3633" else "#1B1F26")
            status.text = when {
                r == null -> "camera offline"
                recName != null -> "recording $recName"
                else -> "saved " + Regex("\\d+").find(r)?.value + " frames"
            }
        }
    }

    private fun driveLoop() {
        var was = false
        while (true) {
            val on = (stick || tilting) && !brake
            if (on || was) {
                var l = 0; var r = 0
                if (on) {
                    val a = jy + jx; val c = jy - jx; val m = max(1f, max(abs(a), abs(c)))
                    l = (a / m * spd).roundToInt(); r = (c / m * spd).roundToInt()
                }
                alive = rover.drive(l, r)
                was = on
            }
            Thread.sleep(100)
        }
    }

    private fun senseLoop() {
        while (true) {
            val s = rover.sense()
            ui.post { show(s) }
            Thread.sleep(250)
        }
    }

    private fun cm(v: Int) = if (v < 0) "--" else "${v / 10}"

    private fun show(s: Sense?) {
        dot.background = bg(if (s != null) "#2EA043" else "#F85149", 6)
        if (s == null) { status.text = "rover offline · long-press to set address"; compass.deg = null; return }
        front = s.front
        upT.text = "↑ ${cm(s.up)} cm"
        frontT.text = "→ ${cm(s.front)} cm"
        frontT.setTextColor(Color.parseColor(if (s.front in 0..199) "#F85149" else "#E7E9EC"))
        compass.deg = if (s.hdg > -99999) ((s.hdg / 10f % 360 + 540) % 360 - 180) else null
        status.text = when {
            brake -> "BRAKE · proximity covered"
            s.mode >= 0 -> "auto: " + (listOf("drive", "turn", "check", "stuck").getOrNull(s.mode) ?: s.mode)
            tilting -> "tilt  steer %+.2f  throttle %+.2f".format(jx, jy)
            stick -> "drive"
            recName != null -> "recording $recName"
            else -> "ready"
        }
        val now = System.currentTimeMillis()
        if (front in 0..199 && jy > 0 && (stick || tilting) && now - buzzed > 300) {
            buzzed = now
            vib.vibrate(VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE))
        }
    }

    override fun onSensorChanged(e: SensorEvent) {
        when (e.sensor.type) {
            Sensor.TYPE_PROXIMITY -> brake = e.values[0] < e.sensor.maximumRange
            else -> {
                if (e.sensor.type == Sensor.TYPE_ACCELEROMETER) for (i in 0..2) grav[i] += .2f * (e.values[i] - grav[i])
                else e.values.copyInto(grav, 0, 0, 3)
                val z = g0
                if (tilting && z != null) {
                    fun dz(v: Float) = if (abs(v) < .1f) 0f else v.coerceIn(-1f, 1f)
                    jx = dz((grav[1] - z[1]) / 3.5f)
                    jy = dz((z[0] - grav[0]) / 3.5f)
                }
            }
        }
    }

    override fun onAccuracyChanged(s: Sensor, a: Int) {}

    override fun onResume() {
        super.onResume()
        val g = sm.getDefaultSensor(Sensor.TYPE_GRAVITY) ?: sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        g?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        sm.getDefaultSensor(Sensor.TYPE_PROXIMITY)?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
    }

    override fun onPause() {
        super.onPause()
        sm.unregisterListener(this)
        stick = false; tilting = false; jx = 0f; jy = 0f
    }
}
