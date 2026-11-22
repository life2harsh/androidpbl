# Architecture

## Layers

```
 Perception          Edge (UNO Q, Debian + MCU)                      Cloud
 ───────────         ─────────────────────────────────────────       ─────────────────────
 HC-SR04 x2  ─┐      MCU sketch ── RPC bridge ── rover app :8080
 MPU gyro    ─┼──►   (stop/turn in firmware)        │  ▲
 motors      ◄┘                                     │  │ HTTP
                                                    ▼  │
 phone camera ─USB─► cam bridge :8081 ◄─────────── hub :8090 ──MQTT/TLS 8883──► AWS IoT Core
   (scrcpy)          H.264 → JPEG                    │  │                     ├─ rule → DynamoDB rover-verdicts
                                                     │  └─ SQLite outbox      ├─ rule → DynamoDB rover-telemetry
                                                     │      (store & forward) ├─ rule → S3 images
                                                     ▼                        └─ Device Shadow (remote patrol)
                                      Mosquitto :1883 ──► Node-RED dashboard
                                                     └──HTTPS bulk──► ThingSpeak 3591852
 Android app ──HTTP (Tailscale)──► rover :8080, cam :8081, hub :8090
```

## Why the split

- **Firmware owns time-critical control.** Stopping at a distance and turning to an angle run in the MCU loop. When this lived in Python, RPC and loop latency caused 16 cm overshoot on stops and 116° on an 85° turn.
- **Python owns sequencing.** Patrol and search are state machines that send setpoints (`hold`, `turn`, `stopmm`) and wait on telemetry.
- **The hub owns data.** It polls the rover at 1 Hz, writes everything to SQLite first, and publishes from there. If WiFi or the cloud drops, rows wait in the `outbox` table and are sent later (AWS QoS 1 in batches of 100, ThingSpeak bulk updates every 16 s).
- **Detection runs at the edge.** YOLO-World (open vocabulary, 40 words) runs on the board at about 0.6 s per frame live, 1 s per search look. No video leaves the device; only verdict images go to S3.

## Patrol state machine

`idle → selfcheck → (drive → capture → turn) × legs → done`, with `failed` on any error.

- **drive:** cruise forward; the firmware brakes when the front sensor reads ≤ the stop distance (slowing at 2× that distance).
- **capture:** torch on, record 1.6 s, need ≥ 5 frames, torch off.
- **turn:** back off if too close, then a firmware gyro turn of 85°.
- **Stationary mode** (`stop=0`): capture only. Used for single-checkpoint demos.
- **Gyro loss** (`hdg ≤ -99999`) aborts the patrol instead of driving blind.

When the patrol is done, the hub compares each checkpoint with the same checkpoint from the previous patrol and publishes a verdict.

## Search state machine

`search → approach → found | lost | failed`

1. Ask the hub to look (`/look?cls=&color=`). If nothing is found, spin 30° and look again, up to 13 times (a full circle).
2. Approach: heading error = (box centre x − 0.5) × 66° FOV. Spin if the error is over 8°, otherwise drive 1.2 s with a firmware stop at 45 cm. Look again. Repeat up to 6 times.
3. Stop when the front distance is ≤ 45 cm or the box fills over 30% of the frame. Report the heading and distance to `rover/found`.

"Fetch" in the app is the same flow with the class and colour of the box the user tapped.
