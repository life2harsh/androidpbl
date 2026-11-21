const fs = require("fs");
const d = require("docx");
const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, AlignmentType, WidthType, BorderStyle,
  ShadingType, PageNumber, NumberFormat, Footer, LevelFormat, TabStopType, PositionalTab, PositionalTabAlignment,
  PositionalTabRelativeTo, PositionalTabLeader, PageBreak, VerticalAlign } = d;

const R = __dirname + "/../";
const FIG = __dirname + "/../figures/";
const PAGES = fs.existsSync(__dirname + "/pages.json") ? JSON.parse(fs.readFileSync(__dirname + "/pages.json")) : {};
const FONT = "Times New Roman";
const W = 9638;

const runs = (text, base = {}) =>
  text.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/).filter(Boolean).map(s =>
    s.startsWith("**") ? new TextRun({ ...base, text: s.slice(2, -2), bold: true })
    : s.startsWith("`") ? new TextRun({ ...base, text: s.slice(1, -1), font: "Courier New", size: 21 })
    : s.startsWith("_") && s.length > 2 ? new TextRun({ ...base, text: s.slice(1, -1), italics: true })
    : new TextRun({ ...base, text: s }));

const P = (text, o = {}) => new Paragraph({ alignment: o.align ?? AlignmentType.JUSTIFIED, spacing: { after: 120 },
  indent: o.indent ? { left: o.indent } : undefined, keepNext: o.keepNext, children: runs(text, o.run) });
const B = text => new Paragraph({ numbering: { reference: "bul", level: 0 }, alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 60 }, children: runs(text) });
const N = text => new Paragraph({ numbering: { reference: "num", level: 0, instance: N.k }, alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 60 }, children: runs(text) });
N.k = 0;

const toc = [], figs = [], tabs = [];
let ch = 0, fig = 0, tab = 0, eq = 0;

const H1 = (title, numbered = true, brk = true) => {
  if (numbered) { ch++; fig = 0; tab = 0; eq = 0; }
  const text = numbered ? `Chapter ${ch}: ${title}` : title;
  toc.push({ level: 1, text });
  return new Paragraph({ heading: d.HeadingLevel.HEADING_1, pageBreakBefore: brk, spacing: brk ? undefined : { before: 360 },
    alignment: numbered ? AlignmentType.CENTER : AlignmentType.LEFT, children: [new TextRun(text)] });
};
const H2 = (num, title) => {
  toc.push({ level: 2, text: `${num}\t${title}`, key: `${num} ${title}` });
  return new Paragraph({ heading: d.HeadingLevel.HEADING_2, tabStops: [{ type: TabStopType.LEFT, position: 720 }],
    children: [new TextRun(`${num}\t${title}`)] });
};
const H3 = title => {
  const [num, ...rest] = title.split(" ");
  toc.push({ level: 3, text: `${num}\t${rest.join(" ")}`, key: title });
  return new Paragraph({ heading: d.HeadingLevel.HEADING_3, children: [new TextRun(title)] });
};

const png = f => { const b = fs.readFileSync(f); return [b, b.readUInt32BE(16), b.readUInt32BE(20)]; };
const Fig = (file, caption, widthFrac = 1) => {
  fig++;
  const label = `Figure ${ch}.${fig}`;
  figs.push({ text: `${label}: ${caption}`, key: `${label}:` });
  if (!fs.existsSync(FIG + file)) return [P(`[${label} pending: ${file}]`, { align: AlignmentType.CENTER }), new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 },
    children: [new TextRun({ text: `${label}: `, bold: true, size: 22 }), ...runs(caption, { size: 22 })] })];
  const [buf, w, h] = png(FIG + file);
  const px = Math.round(W / 15 * widthFrac);
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60, line: 240 },
      children: [new ImageRun({ type: "png", data: buf, transformation: { width: px, height: Math.round(px * h / w) } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 },
      children: [new TextRun({ text: `${label}: `, bold: true, size: 22 }), ...runs(caption, { size: 22 })] }),
  ];
};
Fig.ref = (offset = 1) => `Figure ${ch}.${fig + offset}`;

const border = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
const borders = { top: border, bottom: border, left: border, right: border };
const Tab = (caption, header, rows, widths) => {
  tab++;
  const label = `Table ${ch}.${tab}`;
  tabs.push({ text: `${label}: ${caption}`, key: `${label}:` });
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (t, i, head, keep = true) => new TableCell({ borders, width: { size: widths[i], type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 90, right: 90 },
    shading: head ? { fill: "DCE6F2", type: ShadingType.CLEAR, color: "auto" } : undefined,
    children: [new Paragraph({ keepNext: keep, spacing: { line: 240 }, alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
      children: runs(String(t), { size: 21, bold: head }) })] });
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 200, after: 80 },
      children: [new TextRun({ text: `${label}: `, bold: true, size: 22 }), ...runs(caption, { size: 22 })] }),
    new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: widths, alignment: AlignmentType.CENTER,
      rows: [new TableRow({ tableHeader: true, children: header.map((t, i) => cell(t, i, true)) }),
        ...rows.map((r, j) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, i, false, j < rows.length - 1)) }))] }),
    new Paragraph({ spacing: { after: 120 }, children: [] }),
  ];
};
Tab.ref = (offset = 1) => `Table ${ch}.${tab + offset}`;

const Eq = (text) => {
  eq++;
  return new Paragraph({ tabStops: [{ type: TabStopType.CENTER, position: W / 2 }, { type: TabStopType.RIGHT, position: W }],
    spacing: { before: 60, after: 120 }, children: [new TextRun("\t"), ...runs(text, { italics: false }), new TextRun(`\t(${ch}.${eq})`)] });
};
Eq.ref = (offset = 1) => `Equation (${ch}.${eq + offset})`;

const Code = lines => lines.map((l, i) => new Paragraph({ spacing: { line: 240, after: i === lines.length - 1 ? 160 : 0 }, keepNext: i < lines.length - 1, keepLines: true,
  indent: { left: 360 }, children: [new TextRun({ text: l, font: "Courier New", size: 18 })] }));


const MEMBERS = [["2401030141", "Harsh Jha"], ["2401030133", "Jaydeep Singh"]];
const TEAM = [
  ["Student A", "Harsh Jha (2401030141): Project lead and software. Wrote the Android controller app: the sensor pipeline for tilt steering and the proximity brake, the haptic warning, the joystick and compass views, the H.264 decoder on MediaCodec and the control loops. Wrote the rover firmware (software PWM for four motors, interrupt-driven ultrasonic ranging, the gyro heading filter with its health checks, and the autonomous pilot), the Linux bridge server and the camera streaming service. Set up the Tailscale network, ran the measurements and compiled this report."],
  ["Student B", "Jaydeep Singh (2401030133): Hardware and testing. Assembled the four-wheel chassis and mounted the motors, the two L298N drivers, the HC-SR04 sensors, the MPU6050 and the upward-facing phone camera. Wired the power, motor and sensor connections to the Arduino UNO Q and debugged the wiring. Ran the field trials: driving runs, obstacle and clearance checks, and the distance and heading measurements used in Chapter 3."],
];

const body = [];
const add = (...xs) => xs.flat().forEach(x => body.push(x));
const BJ = FIG + "bench.json";
const BEN = fs.existsSync(BJ) ? JSON.parse(fs.readFileSync(BJ)) : null;
const v = (f, unit = "") => { try { const r = f(BEN); return r == null ? "pending" : r + unit; } catch { return "pending"; } };

add(H1("Introduction"));
add(H2("1.1", "Background"));
add(P("Vehicles entering campuses, malls, hotels and government buildings are checked for objects hidden underneath, usually by a guard holding a mirror on a stick. The check is slow, depends on lighting and attention, and leaves no record that can be reviewed later. A small camera rover that drives under the vehicle can see the whole underside, store what it saw and compare it with an earlier visit."));
add(P("A smartphone is a natural controller for such a rover. It already has a touch screen, motion and proximity sensors, a vibration motor, a hardware video decoder and a network connection. Android exposes these through the `SensorManager`, `Vibrator` and `MediaCodec` APIs [1]-[3]. This report covers the Android part of **Undersight**: an app that drives the rover with a joystick or by tilting the phone, shows the live camera feed, and displays the rover's own sensor readings in real time."));
add(H2("1.2", "Problem Statement"));
add(P("Build an Android application that controls an under-vehicle inspection rover safely and in real time. The app must:"));
add(B("drive the rover with an on-screen joystick and, as an alternative, by tilting the phone using its gravity sensor;"));
add(B("stop the rover immediately when the operator covers the phone's proximity sensor, and whenever the connection is lost;"));
add(B("show the live camera feed from under the vehicle with low latency, and record it on demand;"));
add(B("show the rover's ultrasonic distances and gyro heading, and warn the operator by vibration before a collision;"));
add(B("tag every session with the ambient light level and the GPS position, log all readings to a CSV file and plot the forward distance live;"));
add(B("save still snapshots of the video, and stop the rover hands-free with a double clap picked up by the microphone."));
add(H2("1.3", "Social & Environmental Relevance"));
add(P("Faster and more thorough under-vehicle checks improve security at gates without making guards bend under cars or slowing traffic. Every scan is recorded, so a suspicious finding can be reviewed and compared with earlier visits instead of depending on one person's memory. The rover reuses an old Redmi A2 phone as its camera, which gives a discarded device a second life and keeps the bill of materials low."));
add(P("**Primary SDG:** 11. Sustainable Cities and Communities (safer public spaces). **Secondary SDGs:** 9. Industry, Innovation and Infrastructure; 12. Responsible Consumption and Production (reuse of an old phone)."));
add(H2("1.4", "Scope"));
add(B("**Android app:** joystick and tilt driving, a speed slider, a proximity-sensor brake, haptic collision warnings, a live H.264 video view, recording control, a compass showing the rover's heading, a dialog to set the rover's address, ambient light and GPS readouts, a live distance graph, a CSV telemetry log, video snapshots and a clap-triggered emergency stop."));
add(B("**Rover:** an Arduino UNO Q driving four motors through two L298N drivers, two HC-SR04 ultrasonic sensors (forward and upward), an MPU6050 gyroscope for heading, and a Redmi A2 phone as the upward camera."));
add(B("**Network:** a small HTTP API on the rover, reachable on the local Wi-Fi or from anywhere through a Tailscale private network."));
add(P("The image stitching, change detection and cloud upload of the full Undersight pipeline belong to the IoT lab project and are outside the scope of this report."));

add(H1("System Design & Methodology"));
add(H2("2.1", "Proposed Methodology"));
add(H3("2.1.1 Architecture"));
add(P(`${Fig.ref()} shows the system. The Arduino UNO Q has two processors: an STM32 microcontroller (MCU) that handles the motors and sensors in real time, and a Linux processor that runs the network services. They talk over the board's RPC bridge. The Android app talks only to the Linux side, over HTTP.`));
add(Fig("arch.png", "System architecture of Undersight", 0.95));
add(H3("2.1.2 Rover hardware and sensors"));
add(Tab("Rover sensors and actuators", ["Component", "Interface", "Rate", "Purpose"], [
  ["HC-SR04 (forward)", "TRIG D11, ECHO D3 (interrupt)", "every 60 ms", "Obstacle distance ahead"],
  ["HC-SR04 (upward)", "TRIG D11, ECHO A3 (interrupt)", "every 60 ms", "Clearance to the vehicle underside"],
  ["MPU6050 gyroscope", "I2C at 400 kHz", "100 Hz", "Heading (yaw) of the rover"],
  ["4 DC motors, 2 L298N", "Software PWM, 3 pins per motor", "100 Hz PWM", "Differential (skid) steering"],
  ["Redmi A2 camera", "USB (adb) to the Linux side", "30 fps, 640x480", "Upward camera, H.264 at 1 Mbit/s"],
], [2300, 2900, 1500, 2938]));
add(P("Both ultrasonic sensors share one trigger pin. Their echo pins raise interrupts on both edges, so the MCU timestamps the echo pulse without blocking. Distance in millimetres follows from the speed of sound:"));
add(Eq("d = t_echo × 343 / 2000"));
add(P("A reading older than 250 ms is reported as -1 (no echo), so the app never shows a stale distance."));
add(H3("2.1.3 Heading from the gyroscope"));
add(P("The MPU6050 is mounted at a tilt, so no single gyro axis is vertical. At calibration the MCU averages 200 samples. The mean accelerometer vector gives the direction of gravity, as a unit vector **u**, and the mean gyro reading gives the gyro's zero offset **b**. The yaw rate is the gyro reading projected onto gravity, at 131 LSB per °/s on the ±250 °/s range:"));
add(Eq("ω = ((g − b) · u) / 131"));
add(P("The median of the last three rates removes single-sample spikes caused by corrupted I2C reads. While all motors are off and the rate is below 2 °/s, the offset is updated slowly (**b** ← **b** + 0.01(**g** − **b**)) instead of integrating, which cancels gyro drift while the rover stands still. Otherwise the heading is integrated:"));
add(Eq("θ ← θ + ω_median × Δt"));
add(P("A read counts as bad if it fails, repeats the previous frame byte for byte, or gives an implausible gravity at calibration. After 20 bad reads in a row the IMU is marked absent, the heading is reported as unavailable, and the MCU retries calibration every 2 s. This was added after a cheap MPU6050 clone locked up during testing (Section 3.2.4)."));
add(H3("2.1.4 Android app design"));
add(P(`The app is one landscape \`Activity\` written in Kotlin, with minimum SDK 29 and target SDK 36. Its layout is built in code with \`LinearLayout\` and \`FrameLayout\`. The left pane is a \`SurfaceView\` that shows the video, with a status chip on top. The right pane holds the distances, the light and GPS readout, a live graph of the forward distance, a compass, the joystick, the tilt, record and snapshot buttons, and a speed \`SeekBar\` (60-255). The joystick, the compass and the graph are custom \`View\` classes that draw on a \`Canvas\` and handle touch events. Long-pressing the status chip opens an \`AlertDialog\` with an \`EditText\` to change the rover's address, which is saved in \`SharedPreferences\`. ${Fig.ref()} shows the app.`));
add(Fig("app.png", "Undersight controller app driving the rover", 1));
add(P("Work is split across three threads so the UI never blocks on the network. The **drive thread** sends the current wheel speeds every 100 ms while the joystick or tilt is active, plus one final stop. The **sense thread** polls the rover every 250 ms and posts the readings to the UI thread. The **video thread** receives and decodes the camera stream."));
add(P("The joystick or tilt gives a steering value _x_ and a throttle value _y_ in [-1, 1]. These are mixed into left and right wheel speeds for skid steering and scaled by the speed slider _s_:"));
add(Eq("L = s(y + x) / m,   R = s(y − x) / m,   m = max(1, |y + x|, |y − x|)"));
add(H3("2.1.5 Phone sensors: tilt, brake and haptics"));
add(P("**Tilt steering** uses `TYPE_GRAVITY`, falling back to `TYPE_ACCELEROMETER` smoothed by a low-pass filter (α = 0.2) on phones without a gravity sensor. Both are registered at `SENSOR_DELAY_GAME`. When the operator presses _Hold to tilt_, the current gravity vector is stored as the neutral pose g₀. While the button is held, the change from that pose is converted to steering and throttle, with a dead zone so small hand movements are ignored:"));
add(Eq("x = clamp((g_y − g₀_y) / 3.5),   y = clamp((g₀_x − g_x) / 3.5),   |·| < 0.1 → 0"));
add(P("A tilt of 3.5 m/s² (about 21°) gives full speed. Releasing the button stops the rover, so the operator never needs to find a neutral angle."));
add(P("**Proximity brake.** `TYPE_PROXIMITY` reports a value below its maximum range when something covers the sensor. The app treats that as a brake and stops sending drive commands, so covering the top of the phone with a thumb stops the rover at once."));
add(P("**Haptic warning.** When the forward ultrasonic distance is under 20 cm and the operator is still driving forward, the app vibrates for 40 ms, at most once every 300 ms. The forward distance is also shown in red."));
add(P("All listeners are unregistered in `onPause()`, which also releases the joystick and tilt, so the rover stops if the app goes to the background."));
add(H3("2.1.6 Light, location, logging and clap stop"));
add(P("**Ambient light.** `TYPE_LIGHT` is registered with the proximity sensor in `onResume()`. The reading in lux is shown under the distances and marked _dark_ below 10 lx, where the camera image is no longer reliable for inspection."));
add(P("**Location.** After the runtime permission is granted, the app requests updates every 2 s from the GPS and network providers of `LocationManager`, starting from the last known fix. The latitude, longitude and accuracy are shown on screen, so every inspection is tied to the place where it was done."));
add(P("**Telemetry log and graph.** On every sensor poll (4 Hz) the sense thread appends one row to a CSV file in the app's external files directory: time, upward and forward distance, heading, light, latitude, longitude, emergency-stop state and the name of the active recording. A custom `Graph` view keeps the last 120 forward distances (30 s) in a ring buffer and draws them as a line from 0 to 200 cm."));
add(P("**Snapshot.** The SNAP button copies the current video frame from the `SurfaceView` with `PixelCopy` and saves it as a JPEG in _Pictures/Undersight_ through `MediaStore`, so it appears in the gallery without any storage permission."));
add(P("**Clap emergency stop.** A background thread reads the microphone with `AudioRecord` (16 kHz, mono, 16-bit) and takes the peak amplitude of each buffer. A peak above 18000 counts as a clap, with a 150 ms lockout so one clap is not counted twice. Two claps within 700 ms toggle the emergency stop, which blocks all drive commands like the proximity brake. A long vibration confirms the stop and a short one confirms the release."));
add(H3("2.1.7 Live video"));
add(P("The Redmi A2 is plugged into the UNO Q over USB. A camera service runs the scrcpy server [5] on the phone, which captures the rear camera at 640x480 and 30 fps and encodes H.264 at 1 Mbit/s with a key frame every second. The service serves the stream over HTTP on port 8081, and it can also save frames to disk as JPEG at 10 fps for the later inspection stages."));
add(P("Each frame on the wire has a 12-byte header: an 8-byte presentation timestamp whose top bits flag codec configuration and key frames, and a 4-byte length. The app reads frames with a `DataInputStream` and feeds them to a hardware H.264 decoder created with `MediaCodec`. The decoder renders straight to the `SurfaceView`'s surface, with `KEY_LOW_LATENCY` set on Android 11 and later [3]. If the stream drops, the thread reconnects after 1.5 s."));
add(H3("2.1.8 Network API and fail-safes"));
add(P(`${Tab.ref()} lists the HTTP API served by the rover's Linux side. Every request has an 800 ms timeout in the app.`));
add(Tab("Rover HTTP API used by the app", ["Request", "Response", "Effect"], [
  ["GET /d?l=L&r=R", "204", "Set left and right wheel speeds, -255 to 255"],
  ["GET /ping", "up,front,hdg,mode", "Distances in mm, heading in tenths of a degree, pilot state"],
  ["GET /cal", "204", "Recalibrate the gyro and zero the heading"],
  ["GET :8081/v", "H.264 stream", "Live camera"],
  ["GET :8081/rec/start/NAME, /rec/stop", "JSON", "Start or stop recording frames"],
], [3400, 2200, 4038]));
add(P("The rover must stop if the phone, the app or the network fails. There are three independent layers: the app always sends a final zero command when the stick is released; the Linux server zeroes the wheels if no drive command arrives for 400 ms; and the MCU zeroes each motor that has not been refreshed for 300 ms. On the internet, the rover is reached through Tailscale, a WireGuard-based private network [6], at a fixed address, so the app works the same on campus Wi-Fi and on mobile data."));
add(H3("2.1.9 Syllabus coverage"));
add(Tab("Lab experiments covered by the project", ["Experiment", "Where it is used in Undersight"], [
  ["1-3: Project setup, UI widgets, event handling", "Android Studio project; Button, EditText, TextView, SeekBar, touch listeners"],
  ["5: Sensors and SensorManager", "Sensor discovery, registration in onResume, unregistration in onPause"],
  ["6: Motion detection (accelerometer, gyroscope)", "Tilt steering from the gravity sensor; the rover's MPU6050 gyro heading"],
  ["7: Environmental and other sensors", "Proximity sensor as an emergency brake; light sensor for the lighting check"],
  ["7: GPS-based location tracking", "LocationManager updates; position shown and logged with every reading"],
  ["10: Custom dialog and user interaction", "AlertDialog with EditText for the rover address; custom joystick and compass views"],
  ["11: Camera-based application", "Upward phone camera streamed as H.264 and decoded with MediaCodec; recording; SNAP image capture"],
  ["12: Sensor data logging and visualization", "CSV telemetry log; live graph of the forward distance"],
  ["13: Audio-based clap counter", "Double clap detected with AudioRecord toggles the emergency stop"],
  ["13: Interfacing Android with an external Arduino", "App controls an Arduino UNO Q and reads its ultrasonic and gyro data"],
  ["14: Multi-sensor mini project", "Phone sensors plus rover sensors in one real-time control app"],
], [4200, 5438]));

add(H1("Implementation & Testing"));
add(H2("3.1", "Experimental Setup"));
add(Tab("Hardware and software used", ["Item", "Details"], [
  ["Controller phone", v(b => b.phone)],
  ["Rover board", "Arduino UNO Q (STM32U585 MCU, Qualcomm QRB2210 Linux side, Debian)"],
  ["Rover camera", "Xiaomi Redmi A2 on USB, scrcpy server 3.x, H.264 640x480 at 30 fps"],
  ["Sensors", "2x HC-SR04, MPU6050 (clone, WHO_AM_I 0x70)"],
  ["Drive", "4 DC gear motors, 2x L298N, battery pack"],
  ["App build", "Kotlin, Android Gradle Plugin, minSdk 29, targetSdk 36"],
  ["Network", "Campus or home Wi-Fi, Tailscale for remote access"],
], [2600, 7038]));
add(P("Latency was measured from a laptop on the same network as the phone, with repeated HTTP requests to the rover. Sensor noise was measured with the rover standing still in front of a wall."));
add(H2("3.2", "Results (Test Cases / Screenshots / Output)"));
add(H3("3.2.1 Functional test cases"));
add(Tab("Functional tests of the app", ["Test", "Expected", "Result"], [
  ["Joystick forward, back, left, right", "Rover moves in that direction; stops on release", v(b => b.tests.joystick)],
  ["Hold to tilt and tilt the phone", "Rover follows the tilt; stops on release", v(b => b.tests.tilt)],
  ["Cover the proximity sensor while driving", "Rover stops; status shows BRAKE", v(b => b.tests.brake)],
  ["Drive towards a wall", "Distance turns red and the phone vibrates under 20 cm", v(b => b.tests.haptic)],
  ["Turn Wi-Fi off while driving", "Rover stops within 0.4 s", v(b => b.tests.failsafe)],
  ["Tap the compass", "Heading resets to 0°", v(b => b.tests.compass)],
  ["Press REC, then stop", "Frames saved; count shown in the status chip", v(b => b.tests.rec)],
  ["Long-press status, change address", "App reconnects to the new address", v(b => b.tests.dialog)],
  ["Read the light and GPS line", "Lux and position with accuracy shown", v(b => b.tests.env)],
  ["Press SNAP", "Frame saved in Pictures/Undersight", v(b => b.tests.snap)],
  ["Run the app, then open the CSV", "One row per poll with all fields", v(b => b.tests.csv)],
  ["Double clap while driving", "Rover stops; double clap again resumes", v(b => b.tests.clap)],
], [3300, 4300, 2038]));
add(H3("3.2.2 Command and sensor latency"));
add(Tab("Round-trip time of rover requests", ["Request", "Samples", "Median (ms)", "95th percentile (ms)"], [
  ["/d (drive command)", v(b => b.drive.n), v(b => b.drive.median), v(b => b.drive.p95)],
  ["/ping (sensor readings)", v(b => b.ping.n), v(b => b.ping.median), v(b => b.ping.p95)],
], [3400, 1700, 2100, 2438]));
add(P(`Video: first frame after ${v(b => b.video.first_ms, " ms")}, ${v(b => b.video.fps)} frames per second at ${v(b => b.video.kbps, " kbit/s")}.`));
add(H3("3.2.3 Sensor accuracy and stability"));
add(Tab("Ultrasonic and gyro readings with the rover at rest", ["Sensor", "Samples", "Mean", "Std. deviation"], [
  ["Forward HC-SR04", v(b => b.sonar.front.n), v(b => b.sonar.front.mean, " mm"), v(b => b.sonar.front.std, " mm")],
  ["Upward HC-SR04", v(b => b.sonar.up.n), v(b => b.sonar.up.mean, " mm"), v(b => b.sonar.up.std, " mm")],
  ["Gyro heading drift", v(b => b.drift.secs, " s"), "–", v(b => b.drift.max_deg, "° max")],
], [3000, 1800, 2400, 2438]));
if (BEN && BEN.accuracy) add(Tab("Ultrasonic distance against a measuring tape", ["True distance (cm)", "Measured (cm)", "Error (cm)"],
  BEN.accuracy.map(([t, m]) => [t, m, (m - t).toFixed(1)]), [3200, 3200, 3238]));
add(Fig("rover.png", "The Undersight rover with the upward camera phone", 0.7));
add(H3("3.2.4 Problems found and fixed"));
add(Tab("Problems found during development", ["Problem", "Fix"], [
  ["Firmware failed to compile: the constant MPU clashed with a CMSIS macro", "Renamed the I2C address constant to IMU_ADDR"],
  ["Bridge RPC handlers ran in another thread and corrupted I2C transfers", "Handlers only set flags; I2C and calibration run in loop()"],
  ["The MPU6050 clone locked up after hours idle and returned frozen data", "Frozen or failed reads mark the IMU absent; the app shows no heading instead of a wrong one"],
  ["Writing the gyro range register left this clone's accelerometer at ±4 g, so calibration looped", "Soft-reset the chip before calibrating; keep the default ±250 °/s range"],
  ["Vibration while driving tripped the gravity check, freezing and resetting the heading", "Check gravity only at calibration"],
  ["Gyro spikes from corrupted I2C reads made the heading jump", "Median of the last three readings"],
  ["Campus Wi-Fi firewall intercepts HTTPS, blocking remote access", "Use the rover on its local address on campus; Tailscale elsewhere"],
], [5000, 4638]));

add(H1("Conclusion & Future Scope"));
add(H2("4.1", "Summary of Work and Achievements"));
add(P("Undersight's Android app turns a phone into a safe, real-time controller for an under-vehicle inspection rover, combining the phone's sensors with the rover's sensors in one screen."));
add(B("Joystick and tilt driving with skid-steer mixing and a speed limit, using the gravity sensor and a neutral pose captured on demand."));
add(B("A proximity-sensor brake, haptic collision warnings and three independent fail-safe layers that stop the rover if anything fails."));
add(B("Live 30 fps H.264 video decoded in hardware with MediaCodec, with recording for later inspection."));
add(B("Ultrasonic distances and a drift-corrected gyro heading from the rover, shown in real time."));
add(B("Light and GPS tagging, a CSV telemetry log with a live graph, video snapshots and a hands-free clap stop."));
add(H2("4.2", "Impact on Society, Environmental Sustainability, Ethical Issues and Compliance"));
add(P("**Society and environment.** The rover makes vehicle checks faster, safer for guards and recorded, and it reuses an old phone as its camera. The whole system runs on a low-power board and a battery pack."));
add(P("**Ethics and compliance.** The camera points only at the underside of vehicles, and recordings stay on the rover unless the operator exports them. Inspections should be done with the vehicle owner's knowledge, under the site's security policy. Remote access goes through an encrypted private network and is not open to the public internet."));
add(H2("4.3", "Limitations of the Work and Future Scope"));
add(B("**No position estimate:** the rover knows its heading but not how far it has moved. Wheel encoders would allow full coverage maps of the underside."));
add(B("**Cheap IMU:** the MPU6050 clone needs a power cycle when it locks up. Powering it from a GPIO pin would let the firmware reset it automatically."));
add(B("**Plain HTTP on the local network:** commands are not authenticated when the rover is reached directly on Wi-Fi. A token or Tailscale-only access would fix this."));
add(B("**Next stages:** image stitching, change detection against earlier scans and cloud storage are being built in the IoT lab project."));

add(H1("References", false));
[
  "Android Developers, \"Sensors overview.\" [Online]. Available: https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview",
  "Android Developers, \"Motion sensors.\" [Online]. Available: https://developer.android.com/develop/sensors-and-location/sensors/sensors_motion",
  "Android Developers, \"MediaCodec.\" [Online]. Available: https://developer.android.com/reference/android/media/MediaCodec",
  "G. Milette and A. Stroud, _Professional Android Sensor Programming_. Indianapolis, IN, USA: Wiley, 2012.",
  "Genymobile, \"scrcpy: Display and control your Android device.\" [Online]. Available: https://github.com/Genymobile/scrcpy",
  "Tailscale Inc., \"How Tailscale works.\" [Online]. Available: https://tailscale.com/blog/how-tailscale-works",
  "Arduino, \"UNO Q user manual.\" [Online]. Available: https://docs.arduino.cc/hardware/uno-q/",
  "InvenSense, \"MPU-6000 and MPU-6050 Product Specification, Revision 3.4,\" 2013.",
  "Cytron Technologies, \"HC-SR04 Ultrasonic Sensor User's Manual,\" 2013.",
].forEach((r, i) => add(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 80 },
  indent: { left: 567, hanging: 567 }, children: [new TextRun(`[${i + 1}]\t`), ...runs(r)], tabStops: [{ type: TabStopType.LEFT, position: 567 }] })));

add(H1("Appendix", false));
add(new Paragraph({ spacing: { after: 120 }, keepNext: true, children: [new TextRun({ text: "Team Roles and Contributions:", bold: true })] }));
TEAM.forEach(([s, t]) => add(new Paragraph({ indent: { left: 720 }, spacing: { after: 120 }, alignment: AlignmentType.JUSTIFIED,
  children: [new TextRun({ text: `${s}: `, bold: true }), new TextRun(t)] })));
add(new Paragraph({ spacing: { before: 240, after: 120 }, keepNext: true, children: [new TextRun({ text: "Source code:", bold: true })] }));
add(P("Android app: `android/app/src/main/java/xyz/life2harsh/undersight/` (MainActivity.kt, Rover.kt, Video.kt, Views.kt). Rover firmware: `rover/sketch/sketch.ino`. Bridge server: `rover/python/main.py`. Camera service: `cam/cam.py`."));

const entry = (text, page, indent, bold) => new Paragraph({ spacing: { after: 30, line: 300 }, indent: { left: indent, hanging: indent ? 0 : 0 },
  tabStops: text.includes("\t") ? [{ type: TabStopType.LEFT, position: indent + 720 }] : [],
  children: [new TextRun({ text, bold }), new TextRun({ children: [new PositionalTab({ alignment: PositionalTabAlignment.RIGHT,
    relativeTo: PositionalTabRelativeTo.MARGIN, leader: PositionalTabLeader.DOT })] }), new TextRun({ text: String(page ?? "?"), bold })] });
const plain = t => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 },
  children: [new TextRun({ text: t, bold: true, size: 32 })] });

const prelim = [
  plain("Table of Contents"),
  ...toc.map(e => entry(e.text, PAGES[e.key ?? e.text], [0, 0, 360, 720][e.level], e.level === 1)),
  new Paragraph({ children: [new PageBreak()] }), plain("List of Figures"),
  ...figs.map(e => entry(e.text, PAGES[e.key], 0, false)),
  new Paragraph({ spacing: { before: 360 }, children: [] }), plain("List of Tables"),
  ...tabs.map(e => entry(e.text, PAGES[e.key], 0, false)),
];

const [logo, lw, lh] = png(__dirname + "/../figures/jiit-logo.png");
const C = (t, size, bold, after = 0) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after },
  children: [new TextRun({ text: t, size, bold })] });
const sub = (label, val) => [new TextRun({ text: label, bold: true }), new TextRun(val)];
const member = (lead, enr, name) => new Paragraph({ indent: { left: 1000 }, spacing: { after: 0 },
  children: [new TextRun({ text: lead ? "Submitted By: " : "", bold: true }),
    ...(lead ? [] : [new TextRun({ text: "Submitted By: ", bold: true, color: "FFFFFF" })]),
    new TextRun(`Enrolment No.: ${enr}, Name: ${name}`)] });
const cover = [
  new Paragraph({ spacing: { before: 600 }, children: [] }),
  C("Jaypee Institute of Information Technology, Noida", 32, true, 240),
  C("DEPARTMENT OF COMPUTER SCIENCE & ENGINEERING AND", 24, false), C("INFORMATION TECHNOLOGY", 24, false, 720),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: "Project Title: Undersight: A Phone-Controlled Under-Vehicle", bold: true, size: 32 })] }),
  C("Inspection Rover", 32, true, 600),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 720 },
    children: [new ImageRun({ type: "png", data: logo, transformation: { width: 190, height: Math.round(190 * lh / lw) } })] }),
  ...MEMBERS.map(([e, n], i) => member(i === 0, e, n)),
  new Paragraph({ spacing: { before: 1000 }, children: [] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: sub("Course Name: ", "Sensor Technology and Android Programming Lab") }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Course Code: 26B16CS318", bold: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: sub("Program: ", "B. Tech. CSE/IT") }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("Third Year 5"), new TextRun({ text: "th", superScript: true }), new TextRun(" Semester")] }),
];

const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] });
const page = { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, footer: 567 } };
const H = (size, align, before, after) => ({ run: { font: FONT, size, bold: true, color: "000000" },
  paragraph: { alignment: align, spacing: { before, after, line: 360 }, keepNext: true, keepLines: true } });

const doc = new Document({
  creator: "Harsh Jha", title: "Undersight: A Phone-Controlled Under-Vehicle Inspection Rover",
  styles: {
    default: { document: { run: { font: FONT, size: 24 }, paragraph: { spacing: { line: 360 } } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, ...H(32, AlignmentType.CENTER, 0, 360) },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, ...H(28, AlignmentType.LEFT, 240, 120) },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, ...H(24, AlignmentType.LEFT, 200, 80) },
    ],
  },
  numbering: { config: [
    { reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    { reference: "num", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
  ] },
  sections: [
    { properties: { page }, children: cover },
    { properties: { page: { ...page, pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN } } }, footers: { default: footer }, children: prelim },
    { properties: { page: { ...page, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } }, footers: { default: footer }, children: body },
  ],
});
fs.writeFileSync(__dirname + "/keys.json", JSON.stringify([...toc.map(e => e.key ?? e.text), ...figs.map(e => e.key), ...tabs.map(e => e.key)]));
Packer.toBuffer(doc).then(b => fs.writeFileSync(R + "Undersight_Report.docx", b));
