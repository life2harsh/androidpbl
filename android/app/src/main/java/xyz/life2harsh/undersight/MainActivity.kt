package xyz.life2harsh.undersight

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.view.PixelCopy
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
import org.json.JSONObject
import java.io.File
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
    @Volatile private var lux = -1f
    @Volatile private var loc: Location? = null
    private var extras = false
    private val grav = FloatArray(3)
    private var g0: FloatArray? = null
    private var front = -1
    private var buzzed = 0L
    private var video: Video? = null
    @Volatile private var recName: String? = null
    private val log by lazy {
        File(getExternalFilesDir(null), "telemetry-${stamp()}.csv").bufferedWriter().apply { write("t_ms,up_mm,front_mm,hdg,lux,lat,lon,rec\n") }
    }
    private lateinit var surface: SurfaceView

    private lateinit var dot: View
    private lateinit var status: TextView
    private lateinit var upT: TextView
    private lateinit var frontT: TextView
    private lateinit var compass: Compass
    private lateinit var infoT: TextView
    private lateinit var graph: Graph
    private lateinit var recB: Button
    private lateinit var torchB: Button
    private lateinit var autoB: Button
    private lateinit var overlay: Overlay
    private lateinit var mission: TextView
    private lateinit var findB: Button
    private var noteUntil = 0L
    private var lastState = ""
    private var stateAt = 0L
    @Volatile private var running = false
    private var colour = ""
    @Volatile private var auto = false
    @Volatile private var torch = false

    private fun dp(v: Int) = (v * resources.displayMetrics.density).roundToInt()
    private fun bg(c: String, r: Int = 14) = GradientDrawable().apply { setColor(Color.parseColor(c)); cornerRadius = dp(r).toFloat() }
    private fun label(s: String, size: Float = 13f) = TextView(this).apply { text = s; textSize = size; setTextColor(Color.parseColor("#E7E9EC")) }
    private fun lp(w: Int, h: Int, weight: Float = 0f) = LinearLayout.LayoutParams(w, h, weight)
    private fun button(s: String) = Button(this).apply {
        text = s; isAllCaps = false; setTextColor(Color.parseColor("#E7E9EC")); background = bg("#1B1F26"); minHeight = dp(44); maxLines = 1; setPadding(dp(4), 0, dp(4), 0)
        foreground = RippleDrawable(ColorStateList.valueOf(0x55FFFFFF), null, bg("#FFFFFF"))
    }

    private fun note(s: String) { status.text = s; noteUntil = System.currentTimeMillis() + 3000 }

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
        thread(isDaemon = true, name = "dets") { while (true) { rover.get("/dets", 8090)?.let { runCatching { overlay.update(it) } }; Thread.sleep(150) } }
        val need = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        if (need.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }) startExtras() else requestPermissions(need, 1)
    }

    private fun videoPane() = FrameLayout(this).apply {
        background = bg("#000000")
        clipToOutline = true
        surface = SurfaceView(context)
        addView(surface.apply {
            holder.addCallback(object : SurfaceHolder.Callback {
                override fun surfaceCreated(h: SurfaceHolder) {
                    video = Video(h.surface, { "http://${rover.host}:8081/v" }) { ok -> ui.post { if (!ok) note("camera reconnecting") } }.also { it.start() }
                }
                override fun surfaceChanged(h: SurfaceHolder, f: Int, w: Int, ht: Int) {}
                override fun surfaceDestroyed(h: SurfaceHolder) { video?.close(); video = null }
            })
        }, FrameLayout.LayoutParams(-1, -1, Gravity.CENTER))
        this@MainActivity.overlay = Overlay(context) { cls, col -> if (running) note("search running · press STOP first") else { this@MainActivity.overlay.target = cls; colour = col; find() } }
        addView(this@MainActivity.overlay, FrameLayout.LayoutParams(-1, -1))
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
        addView(LinearLayout(context).apply {
            findB = button("FIND").apply { background = bg("#990D0F12", 10); minWidth = dp(72); setOnClickListener { find() }; setOnLongClickListener { pickTarget(); true } }
            addView(findB, lp(-2, dp(44)))
            for ((t, path) in listOf("⟳" to "/cam/rot", "⇄" to "/cam/switch"))
                addView(button(t).apply { background = bg("#990D0F12", 10); setOnClickListener { camCfg(path) } }, lp(dp(44), dp(44)).apply { leftMargin = dp(6) })
        }, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END).apply { setMargins(0, dp(10), dp(10), 0) })
        mission = label("", 15f).apply { visibility = View.GONE; gravity = Gravity.CENTER; setPadding(dp(16), dp(8), dp(16), dp(8)) }
        addView(mission, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(14) })
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
                infoT = label("☀ -- lx   ⌖ no fix", 12f).apply { setTextColor(Color.parseColor("#8B9099")) }; addView(infoT)
            }, lp(0, -2, 1f))
            compass = Compass(context).apply { setOnClickListener { thread { rover.get("/cal") } } }
            addView(compass, lp(dp(84), dp(84)))
        })
        graph = Graph(context)
        addView(graph, lp(-1, dp(36)).apply { topMargin = dp(4) })
        addView(Joystick(context) { x, y, down -> jx = x; jy = y; stick = down }, lp(-1, 0, 1f).apply { setMargins(0, dp(8), 0, dp(8)) })
        addView(LinearLayout(context).apply {
            addView(button("TILT").apply {
                setOnTouchListener { v, e ->
                    when (e.actionMasked) {
                        MotionEvent.ACTION_DOWN -> { g0 = grav.clone(); tilting = true; v.background = bg("#1F6FEB") }
                        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { tilting = false; jx = 0f; jy = 0f; v.background = bg("#1B1F26") }
                    }
                    true
                }
            }, lp(0, -2, 1f))
            recB = button("● REC").apply { setOnClickListener { toggleRec() } }
            addView(recB, lp(0, -2, 1f).apply { leftMargin = dp(8) })
            addView(button("SNAP").apply { setOnClickListener { snap() } }, lp(0, -2, 1f).apply { leftMargin = dp(8) })
            torchB = button("TORCH").apply { setOnClickListener { toggleTorch() } }
            addView(torchB, lp(0, -2, 1f).apply { leftMargin = dp(8) })
            autoB = button("AUTO").apply { setOnClickListener { auto = !auto; background = bg(if (auto) "#2EA043" else "#1B1F26"); note("auto " + if (auto) "on" else "off"); thread { rover.get("/a?on=" + (if (auto) 1 else 0)) } } }
            addView(autoB, lp(0, -2, 1f).apply { leftMargin = dp(8) })
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

    private fun find() {
        if (running) { note("stopping…"); findB.text = "…"; thread { rover.get("/patrol?abort=1") }; return }
        note("starting search for $colour ${overlay.target}".replace("_", " "))
        findB.text = "…"
        thread { if (rover.get("/search?cls=${overlay.target}&color=$colour") == null) ui.post { note("rover offline"); findB.text = "FIND" } }
    }

    private fun mission(j: JSONObject) {
        val s = j.optString("state")
        val now = System.currentTimeMillis()
        if (s != lastState) { lastState = s; stateAt = now }
        val g = j.optString("target").replace("_", " ").ifEmpty { "target" }
        val (t, c) = when (s) {
            "search" -> "Searching for $g…" to "#1F6FEB"
            "approach" -> "Driving to $g…" to "#1F6FEB"
            "found" -> "Found $g ✓" to "#2EA043"
            "failed" -> "Failed: ${j.optString("err")}" to "#DA3633"
            "abort" -> "Stopping…" to "#9A6700"
            "selfcheck", "drive", "capture", "turn" -> "Patrol leg ${j.optInt("cp") + 2}/${j.optInt("legs")}: $s…" to "#1F6FEB"
            "done" -> "Patrol done ✓" to "#2EA043"
            else -> "" to "#000000"
        }
        running = s in setOf("selfcheck", "drive", "capture", "turn", "search", "approach", "abort")
        findB.text = if (running) "STOP" else "FIND"
        findB.background = bg(if (running) "#DA3633" else "#990D0F12", 10)
        mission.visibility = if (t.isEmpty() || (!running && now - stateAt > 10000)) View.GONE else View.VISIBLE
        if (t.isNotEmpty()) { mission.text = t; mission.background = bg(c, 18) }
    }

    private fun pickTarget() = thread {
        val classes = rover.get("/classes", 8090)?.let { runCatching { org.json.JSONArray(it).let { a -> Array(a.length()) { a.getString(it) } } }.getOrNull() } ?: arrayOf("person")
        runOnUiThread { pickTarget(classes) }
    }

    private fun pickTarget(classes: Array<String>) {
        val colours = arrayOf("any", "red", "orange", "yellow", "green", "blue", "purple", "white", "grey", "black")
        AlertDialog.Builder(this).setTitle("Search for").setItems(classes.map { it.replace("_", " ") }.toTypedArray()) { _, i ->
            AlertDialog.Builder(this).setTitle("Colour").setItems(colours) { _, j ->
                overlay.target = classes[i]
                colour = if (j == 0) "" else colours[j]
                note("target: $colour ${classes[i]}".replace("_", " "))
            }.show()
        }.show()
    }

    private fun camCfg(path: String) = thread {
        val r = rover.get(path, 8081)
        ui.post { note(if (r == null) "camera offline" else if (path.endsWith("rot")) "rotated" else "switched camera") }
    }

    private fun toggleTorch() = thread {
        val r = rover.get("/torch/" + (if (torch) 0 else 1), 8081)
        if (r != null) torch = "true" in r
        ui.post {
            torchB.background = bg(if (torch) "#9A6700" else "#1B1F26")
            note(if (r == null) "camera offline" else "torch " + if (torch) "on" else "off")
        }
    }

    private fun toggleRec() = thread {
        val name = recName
        val r = if (name == null) {
            val n = stamp()
            rover.get("/rec/start/$n", 8081)?.also { recName = n }
        } else rover.get("/rec/stop", 8081)?.also { recName = null }
        ui.post {
            recB.background = bg(if (recName != null) "#DA3633" else "#1B1F26")
            note(when {
                r == null -> "camera offline"
                recName != null -> "recording $recName"
                else -> "saved " + Regex("\\d+").find(r)?.value + " frames"
            })
        }
    }

    private fun stamp() = SimpleDateFormat("yyyy-MM-dd-HH-mm-ss", Locale.US).format(Date())

    private fun snap() {
        val b = Bitmap.createBitmap(surface.width, surface.height, Bitmap.Config.ARGB_8888)
        PixelCopy.request(surface, b, { r ->
            if (r != PixelCopy.SUCCESS) { note("no frame to save"); return@request }
            val cv = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, "undersight-${stamp()}.jpg")
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Undersight")
            }
            thread {
                contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv)?.let { u ->
                    contentResolver.openOutputStream(u)?.use { b.compress(Bitmap.CompressFormat.JPEG, 92, it) }
                }
                ui.post { note("saved to Pictures/Undersight") }
            }
        }, ui)
    }

    override fun onRequestPermissionsResult(c: Int, p: Array<out String>, g: IntArray) = startExtras()

    @SuppressLint("MissingPermission")
    private fun startExtras() {
        if (extras) return
        extras = true
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED)
            getSystemService(LocationManager::class.java).run {
                for (pr in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { isProviderEnabled(it) }) {
                    getLastKnownLocation(pr)?.let { if (loc == null) loc = it }
                    requestLocationUpdates(pr, 2000, 0f, { loc = it }, Looper.getMainLooper())
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
        var n = 0
        while (true) {
            if (n++ % 2 == 0) rover.get("/patrol")?.let { runCatching { JSONObject(it) }.getOrNull() }?.let { ui.post { mission(it) } }
            val s = rover.sense()
            ui.post { show(s) }
            val l = loc
            log.write("${System.currentTimeMillis()},${s?.up ?: ""},${s?.front ?: ""},${s?.hdg ?: ""},${if (lux < 0) "" else lux},${l?.latitude ?: ""},${l?.longitude ?: ""},${recName ?: ""}\n")
            Thread.sleep(250)
        }
    }

    private fun cm(v: Int) = if (v < 0) "--" else "${v / 10}"

    private fun show(s: Sense?) {
        dot.background = bg(if (s != null) "#2EA043" else "#F85149", 6)
        if (s == null) { status.text = "rover offline · long-press to set address"; compass.deg = null; return }
        front = s.front
        graph.add(if (s.front < 0) -1f else s.front / 10f)
        val l = loc
        infoT.text = (if (lux < 0) "☀ -- lx" else "☀ ${lux.roundToInt()} lx" + if (lux < 10) " dark" else "") +
            "   ⌖ " + (l?.let { "%.5f, %.5f ±%dm".format(it.latitude, it.longitude, it.accuracy.roundToInt()) } ?: "no fix")
        upT.text = "↑ ${cm(s.up)} cm"
        frontT.text = "→ ${cm(s.front)} cm"
        frontT.setTextColor(Color.parseColor(if (s.front in 0..199) "#F85149" else "#E7E9EC"))
        if (auto && brake) { auto = false; thread { rover.get("/a?on=0") } }
        autoB.background = bg(if (s.mode >= 0) "#2EA043" else "#1B1F26")
        compass.deg = if (s.hdg > -99999) ((s.hdg / 10f % 360 + 540) % 360 - 180) else null
        if (System.currentTimeMillis() > noteUntil) status.text = when {
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
            Sensor.TYPE_LIGHT -> lux = e.values[0]
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
        for (t in listOf(Sensor.TYPE_PROXIMITY, Sensor.TYPE_LIGHT)) sm.getDefaultSensor(t)?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
    }

    override fun onPause() {
        super.onPause()
        sm.unregisterListener(this)
        log.flush()
        stick = false; tilting = false; jx = 0f; jy = 0f
    }
}
