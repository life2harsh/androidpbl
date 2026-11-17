package xyz.life2harsh.undersight

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.MotionEvent
import android.view.View
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sin

private fun paint(c: Int, stroke: Float = 0f) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = c
    if (stroke > 0) { style = Paint.Style.STROKE; strokeWidth = stroke }
}

class Joystick(ctx: Context, private val onMove: (Float, Float, Boolean) -> Unit) : View(ctx) {
    private val base = paint(Color.parseColor("#1B1F26"))
    private val idle = paint(Color.parseColor("#2D333B"))
    private val act = paint(Color.parseColor("#1F6FEB"))
    private var kx = 0f
    private var ky = 0f
    private var down = false

    override fun onDraw(c: Canvas) {
        val r = min(width, height) / 2f
        c.drawCircle(width / 2f, height / 2f, r, base)
        c.drawCircle(width / 2f + kx * r * .6f, height / 2f + ky * r * .6f, r * .38f, if (down) act else idle)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        val r = min(width, height) / 2f * .6f
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                var x = (e.x - width / 2f) / r
                var y = (e.y - height / 2f) / r
                val d = hypot(x, y)
                if (d > 1) { x /= d; y /= d }
                kx = x; ky = y; down = true
                val dead = hypot(x, y) < .15f
                onMove(if (dead) 0f else x, if (dead) 0f else -y, true)
            }
            else -> { kx = 0f; ky = 0f; down = false; onMove(0f, 0f, false) }
        }
        invalidate()
        return true
    }
}

class Compass(ctx: Context) : View(ctx) {
    private val ring = paint(Color.parseColor("#2D333B"), 6f)
    private val needle = paint(Color.parseColor("#F85149"), 8f).apply { strokeCap = Paint.Cap.ROUND }
    private val text = paint(Color.parseColor("#E7E9EC")).apply { textAlign = Paint.Align.CENTER }
    var deg: Float? = null
        set(v) { field = v; invalidate() }

    override fun onDraw(c: Canvas) {
        val r = min(width, height) / 2f - 6
        val cx = width / 2f
        val cy = height / 2f
        c.drawCircle(cx, cy, r, ring)
        text.textSize = r * .42f
        val d = deg ?: return c.drawText("--", cx, cy + text.textSize / 3, text)
        val a = Math.toRadians(d.toDouble())
        c.drawLine(cx, cy, cx + (sin(a) * r * .8).toFloat(), cy - (cos(a) * r * .8).toFloat(), needle)
        c.drawText("%.0f°".format(d), cx, cy + r * .75f, text)
    }
}
