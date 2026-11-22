# Patrol rover

Autonomous indoor patrol rover on an Arduino UNO Q. It drives a fixed route, photographs checkpoints, and flags anything that changed since the last patrol. It can also search for a named object ("find person", "red backpack") and drive up to it. Telemetry and results go to a local MQTT/Node-RED dashboard, ThingSpeak, and AWS IoT Core (DynamoDB + S3).

| Path | What it is |
|---|---|
| `rover/sketch/sketch.ino` | MCU firmware: motors, two ultrasonic sensors, gyro, firmware-side stop and turn |
| `rover/python/main.py` | Linux-side rover app (`:8080`): manual drive, patrol and search state machines |
| `cam/cam.py` | Phone camera bridge (`:8081`): scrcpy H.264 stream, snapshots, recording, torch |
| `vision/vision.py` | Change detection (ORB + RANSAC + ECC alignment, CLAHE, SSIM) |
| `iot/` | Edge IoT stack: Mosquitto, hub (`:8090`), Node-RED dashboard (`:1880/dashboard`) |
| `iot/aws/setup.sh` | Reproducible AWS setup (thing, cert, policy, rules, tables, bucket, budget) |
| `android/` | Controller app: live video with detection boxes, drive, patrol, find/fetch |
| `notebooks/analysis.ipynb` | Analysis of the hub's recorded data |

Docs: [architecture](docs/architecture.md) · [interfaces](docs/interfaces.md) · [cloud](docs/cloud.md) · [vision and detection](docs/vision.md) · [running it](docs/running.md)
