# Interfaces

## HTTP

| Service | Endpoint | Purpose |
|---|---|---|
| rover `:8080` | `/ping` | `rear,front,hdg*10,mode` (mm, mm, deci-degrees) |
| | `/d?...` | manual drive |
| | `/patrol?legs=N&stop=mm` | start patrol (`stop=0`: stationary) |
| | `/patrol?abort=1` | abort |
| | `/search?cls=&color=` | start search / fetch |
| cam `:8081` | `/v` | raw H.264 stream |
| | `/live.jpg` | latest decoded frame (persistent ffmpeg decoder) |
| | `/snap.jpg` | fresh keyframe snapshot |
| | `/rec/start/<n>`, `/rec/stop` | record frames to `/scans/<n>` |
| | `/torch/0\|1`, `/cam/rot`, `/cam/switch` | phone torch, rotate, switch lens |
| hub `:8090` | `/dets` | live detections `{dets:[{cls,score,colour,box:[x,y,w,h] normalised}]}` |
| | `/look?cls=&sid=&color=` | one detection pass for search; saves `last.jpg` / `hit.jpg` |
| | `/found?r=` | search result, published to `rover/found` |

## MQTT (Mosquitto `:1883`)

| Topic | Retained | To cloud | Payload |
|---|---|---|---|
| `rover/telemetry` | no | yes | `{rear, front, heading, mode, patrol}` at 1 Hz |
| `rover/status` | yes | | online/offline |
| `rover/patrol` | yes | yes | `{id, legs, state, err}` |
| `rover/verdict` | yes | yes | `{pid, cp, ref, verdict, inliers, ssim, changed, regions}` |
| `rover/img/<pid>/<cp>` | | yes (S3) | JPEG of diff or checkpoint |
| `rover/cmd` | | | `{"patrol":N}` or `{"search":cls,"color":c}` (from dashboard) |
| `rover/search`, `rover/found` | yes | yes | search progress and result |

## SQLite (`iot/data/hub.db`)

- `telemetry(ts, rear, front, hdg, mode, patrol)`
- `patrols(pid, legs, state, err, ts)`
- `verdicts(pid, cp, ref, verdict, inliers, ssim, changed, regions, ts)`
- `outbox(id, dest, topic, body, ts)`: `dest` is `aws` or `ts`. A row is deleted only after delivery is confirmed. AWS telemetry is capped at the newest 5000 rows.
