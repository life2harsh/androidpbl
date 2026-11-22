package xyz.life2harsh.undersight

import java.net.HttpURLConnection
import java.net.URL

data class Sense(val up: Int, val front: Int, val hdg: Int, val mode: Int)

class Rover(@Volatile var host: String) {
    fun get(path: String, port: Int = 8080): String? = try {
        (URL("http://$host:$port$path").openConnection() as HttpURLConnection).run {
            connectTimeout = 800
            readTimeout = 800
            inputStream.use { it.readBytes().decodeToString() }
        }
    } catch (e: Exception) {
        null
    }

    fun sense(): Sense? = get("/ping")?.split(',')?.mapNotNull { it.trim().toIntOrNull() }
        ?.takeIf { it.size >= 4 }?.let { Sense(it[0], it[1], it[2], it[3]) }

    fun drive(l: Int, r: Int) = get("/d?l=$l&r=$r") != null
}
