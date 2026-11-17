# Undersight Android controller

Native Kotlin app (no AndroidX, ~35 KB APK) that drives the rover and shows its live camera and sensors.

## Features
- **Live camera**: H.264 from `http://<rover>:8081/v` (scrcpy packet framing: 8-byte flags+PTS, 4-byte length) decoded with `MediaCodec` straight onto a `SurfaceView`.
- **Joystick**: skid-steer mix `l = y + x`, `r = y - x`, normalised, scaled by the SPD slider, sent to `/d?l=&r=` at 10 Hz. The rover stops by itself if commands stop for 0.4 s.
- **Tilt drive** (phone accelerometer / gravity sensor): hold the button; the gravity vector at press time becomes neutral. Device `x` → throttle, device `y` → steering (landscape), ±3.5 m/s² full scale, 0.1 dead zone.
- **Proximity brake** (phone proximity sensor): covering it forces a stop while covered.
- **Haptic warning**: vibrates when driving forward with the rover's front HC-SR04 under 20 cm.
- **Rover sensors**: upward and forward HC-SR04 distances and MPU6050 heading compass from `/ping` every 250 ms. Tap the compass to zero heading.
- **REC**: starts/stops frame recording on the rover (`:8081/rec/start/<name>`, `/rec/stop`).
- Long-press the status pill to change the rover address (default Tailscale `100.94.97.102`, or LAN IP).

## Build
```
cd android
JAVA_HOME=/opt/android-studio/jbr ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```
