package xyz.life2harsh.undersight

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import org.json.JSONObject

class Overlay(ctx: Context, private val tap: (String, String) -> Unit) : View(ctx) {
    data class Det(val cls: String, val colour: String, val score: Double, val r: RectF)

    @Volatile var dets = emptyList<Det>()
    var target = "person"
    private val box = Paint().apply { style = Paint.Style.STROKE; strokeWidth = 4f; color = Color.parseColor("#2EA043") }
    private val hit = Paint(box).apply { color = Color.parseColor("#F85149"); strokeWidth = 6f }
    private val text = Paint().apply { color = Color.WHITE; textSize = 30f; isAntiAlias = true }
    private val tag = Paint().apply { color = Color.parseColor("#B30D0F12") }

    fun update(json: String) {
        val a = JSONObject(json).optJSONArray("dets") ?: return
        dets = (0 until a.length()).map { i ->
            val d = a.getJSONObject(i)
            val b = d.getJSONArray("box")
            Det(d.getString("cls"), d.optString("colour"), d.getDouble("score"),
                RectF(b.getDouble(0).toFloat(), b.getDouble(1).toFloat(), (b.getDouble(0) + b.getDouble(2)).toFloat(), (b.getDouble(1) + b.getDouble(3)).toFloat()))
        }
        postInvalidate()
    }

    override fun onDraw(c: Canvas) {
        for (d in dets) {
            val r = RectF(d.r.left * width, d.r.top * height, d.r.right * width, d.r.bottom * height)
            c.drawRect(r, if (d.cls == target) hit else box)
            val label = "${d.colour} ${d.cls} ${(d.score * 100).toInt()}%"
            val y = maxOf(r.top, 36f)
            c.drawRect(r.left, y - 32f, r.left + text.measureText(label) + 12f, y, tag)
            c.drawText(label, r.left + 6f, y - 8f, text)
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (e.action != MotionEvent.ACTION_UP) return true
        val d = dets.filter { it.r.contains(e.x / width, e.y / height) }.minByOrNull { it.r.width() * it.r.height() } ?: return false
        tap(d.cls, d.colour)
        return true
    }
}
