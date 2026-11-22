const { P, B, H1, H2, H3, Fig, Tab, Eq, Code, add, finish } = require("./lib");

const MEMBERS = [["2401030141", "Harsh Jha"], ["2401030133", "Jaydeep Singh"]];
const TEAM = [
  ["Student A", "Harsh Jha (2401030141): Project lead and software. Wrote the rover firmware (firmware-side stop and turn, gated ultrasonic ranging, gyro heading), the patrol and search state machines, the camera bridge with its live decoder, the edge hub (telemetry poller, SQLite store-and-forward, change detection, YOLO-World object detection), the MQTT topic design and the Node-RED dashboard. Set up AWS IoT Core, the rules, DynamoDB, S3, the Device Shadow and the budget, and the ThingSpeak channel. Ran the model benchmark, wrote the analysis notebook and compiled this report."],
  ["Student B", "Jaydeep Singh (2401030133): Hardware and testing. Assembled the four-wheel chassis and mounted the motors, the two L298N drivers, the HC-SR04 sensors, the MPU6050 and the phone camera. Wired the power, motor and sensor connections to the Arduino UNO Q and debugged the wiring. Ran the field trials: patrol runs with objects moved between checkpoints, search runs for people and shoes, and the distance and heading checks used in Chapter 3."],
];

add(H1("Introduction"));
add(H2("1.1", "Background"));
add(P("Security staff patrol offices, hostels, labs and storerooms to check that nothing has been moved, left behind or tampered with. The check is manual, it depends on one person's memory of how a room looked, and it leaves no record that can be compared later. In search situations, such as finding a person or an object in a dark or cluttered room, a person has to enter the space first."));
add(P("An IoT system can do both jobs with a small rover. Sensors on the rover measure distance and heading, a camera captures each checkpoint, an edge computer decides whether the scene has changed or where a requested object is, and the results flow to a dashboard and to the cloud, where they are stored and analysed. This report presents such a system, built on an Arduino UNO Q, with MQTT, Node-RED, SQLite, ThingSpeak and AWS IoT Core, and analysed with NumPy and Pandas."));
add(H2("1.2", "Problem Statement"));
add(P("Design and implement an IoT patrol rover that:"));
add(B("drives a patrol route on its own, stops at checkpoints using its ultrasonic sensors and turns using its gyroscope;"));
add(B("photographs every checkpoint and decides automatically whether anything changed since the previous patrol;"));
add(B("finds a requested object (for example a person or a shoe), with an optional colour, and drives up to it;"));
add(B("publishes live telemetry and results over MQTT to a local dashboard, and stores everything locally first so no data is lost when the network or the cloud is down;"));
add(B("synchronises telemetry, verdicts and images to ThingSpeak and to AWS (IoT Core, DynamoDB and S3), and can be commanded from the cloud;"));
add(B("produces data that can be analysed to measure sensor quality, uptime and detection results."));
add(H2("1.3", "Social & Environmental Relevance"));
add(P("The rover makes routine security checks consistent and recorded: every checkpoint image, verdict and reading is kept with a timestamp, so a change can be proven instead of remembered. The same rover can search a room for a person before anyone enters, which matters in search-and-rescue situations. The design reuses an old Redmi A2 phone as its camera and runs all vision on a low-power board, so video never needs to leave the device."));
add(P("**Primary SDG:** 9. Industry, Innovation and Infrastructure. **Secondary SDGs:** 11. Sustainable Cities and Communities (safer buildings); 12. Responsible Consumption and Production (reuse of an old phone)."));
add(H2("1.4", "Scope"));
add(B("**Edge device:** an Arduino UNO Q (STM32 microcontroller plus a Linux processor) with two HC-SR04 ultrasonic sensors, an MPU6050 gyroscope, four motors on two L298N drivers and a USB phone camera."));
add(B("**Automation:** patrol and search state machines with firmware-side stopping and turning."));
add(B("**Communication:** HTTP between services, MQTT (Mosquitto) for telemetry and results, MQTT over TLS to AWS, HTTPS to ThingSpeak, and a Node-RED dashboard."));
add(B("**Storage:** SQLite on the board as the system of record and an outbox queue for the cloud."));
add(B("**Cloud:** ThingSpeak channel; AWS IoT Core with X.509 certificates, topic rules into DynamoDB and S3, a Device Shadow for remote commands, and a cost budget."));
add(B("**Analytics:** image change detection (ORB, RANSAC, ECC, CLAHE, SSIM), open-vocabulary object detection (YOLO-World), and a Pandas notebook over the recorded data."));
add(P("The project synopsis targeted inspection under parked vehicles. The delivered system applies the same pipeline (autonomous capture, change detection against the previous run, MQTT, local storage, cloud and analytics) to indoor checkpoint patrol, and adds object search. Under-vehicle mosaics are listed as future work in Section 4.3."));

add(H1("System Design & Methodology"));
add(H2("2.1", "Proposed Methodology"));
add(H3("2.1.1 Architecture"));
add(P(`${Fig.ref()} shows the system in three layers. Perception: sensors, motors and the camera. Edge: the UNO Q, which makes every control and vision decision itself. Cloud: storage, remote commands and dashboards. The network carries commands and results but is never part of the control loop, so the rover stays safe when it drops.`));
add(Fig("iot-arch.png", "System architecture", 0.85));
add(Tab("Edge services on the Arduino UNO Q", ["Service", "Port", "Role"], [
  ["STM32 firmware", "RPC bridge", "Motors, ultrasonic ranging, gyro heading, firmware stop and turn"],
  ["Rover app (Python)", "8080", "Patrol and search state machines, manual drive API"],
  ["Camera bridge", "8081", "scrcpy H.264 stream from the phone; snapshots, recording, live JPEG"],
  ["Hub (Python, Docker)", "8090", "Telemetry poller, SQLite, change detection, object detection, cloud sender"],
  ["Mosquitto (Docker)", "1883", "Local MQTT broker"],
  ["Node-RED (Docker)", "1880", "Dashboard 2.0 with live gauges, patrol and search controls"],
], [2600, 1300, 5738]));
add(H3("2.1.2 Sensors and data acquisition"));
add(Tab("Sensors and actuators", ["Component", "Interface", "Rate", "Data"], [
  ["HC-SR04 (front)", "TRIG D11, ECHO D3 (interrupt)", "every 60 ms", "Distance ahead, mm"],
  ["HC-SR04 (rear)", "TRIG D11, ECHO A3 (interrupt)", "every 60 ms", "Distance behind, mm"],
  ["MPU6050 gyroscope", "I2C 400 kHz", "100 Hz", "Heading, tenths of a degree"],
  ["Redmi A2 camera", "USB (adb), scrcpy", "15 fps, 640x480", "H.264, 1 Mbit/s"],
  ["4 DC motors, 2x L298N", "Software PWM", "100 Hz", "Skid steering"],
], [2300, 2900, 1600, 2838]));
add(P("Both ultrasonic sensors share one trigger pin, so one sensor can pick up the other's echo, and motor noise adds false edges. The firmware therefore accepts a new echo time only if it is within 0.9 ms of the last accepted value, or if three consecutive readings agree. Distance follows from the speed of sound:"));
add(Eq("d = t_echo × 343 / 2000   (mm, with t_echo in µs)"));
add(P("A reading older than 250 ms or longer than 23 ms (about 4 m) is reported as -1. The hub polls the rover at 1 Hz and stores rear, front, heading, mode and patrol state as one telemetry row."));
add(H3("2.1.3 Sensor-based automation: patrol"));
add(P("A patrol is a sequence of legs. On each leg the rover cruises forward until the front distance falls to the stop distance, captures the checkpoint, backs off if it is too close, and turns 85°. The decisions that need fast reaction run in the firmware, because Python and the RPC bridge added up to 16 cm of overshoot on stops and 116° on an 85° turn:"));
add(B("**Stop:** the firmware slows to a crawl when the front distance is under twice the stop distance and brakes at the stop distance. Both states latch, so one noisy reading cannot restart the motors."));
add(B("**Turn:** the firmware spins until the measured heading change reaches the target minus the distance it will coast at the current rate (rate × 0.12 s)."));
add(B("**Capture:** the phone torch is switched on, 1.6 s of frames are recorded, at least 5 frames are required, and the torch is switched off."));
add(B("**Safety:** if the gyro is lost the patrol aborts instead of driving blind. The firmware stops any motor that is not refreshed for 300 ms."));
add(P("The patrol states are `selfcheck → (drive → capture → turn) × legs → done`, with `failed` on any error. A stationary mode (stop distance 0) captures without driving, which was used for repeatable change-detection tests."));
add(H3("2.1.4 Communication: MQTT, HTTP and Node-RED"));
add(P(`Services on the board talk over HTTP. Results go to the local Mosquitto broker, which feeds the Node-RED dashboard. ${Tab.ref()} lists the topics.`));
add(Tab("MQTT topics", ["Topic", "Retained", "Payload"], [
  ["rover/telemetry", "no", "rear, front, heading, mode, patrol state (1 Hz)"],
  ["rover/status", "yes", "online / offline"],
  ["rover/patrol", "yes", "patrol id, legs, state, error"],
  ["rover/verdict", "yes", "pid, checkpoint, reference, verdict, inliers, SSIM, % changed, regions"],
  ["rover/img/<pid>/<cp>", "no", "JPEG of the diff or checkpoint (cloud only)"],
  ["rover/cmd", "no", "{\"patrol\": N} or {\"search\": class, \"color\": c} from the dashboard"],
  ["rover/search, rover/found", "yes", "search progress and final result"],
], [2900, 1200, 5538]));
add(P(`The dashboard (${Fig.ref()}) shows live distance gauges, heading, patrol state and online status, buttons to start a 4-leg or single-leg patrol, the latest checkpoint image, a table of verdicts, a distance history chart and a search panel with a target drop-down. Node-RED serves the saved images directly from the board's scan folder.`));
add(Fig("iot-dashboard.png", "Node-RED dashboard", 0.8));
add(H3("2.1.5 Data storage: SQLite and store-and-forward"));
add(P("Every record is written to SQLite on the board before it is published anywhere. The database is the system of record; the cloud is a copy. SQLite was used instead of MySQL on a Raspberry Pi because it runs inside the hub process on the UNO Q with no server, and it speaks the same SQL."));
add(Code([
  "create table telemetry(ts real, rear int, front int, hdg int, mode int, patrol text);",
  "create table patrols(pid text primary key, legs int, state text, err text, ts real);",
  "create table verdicts(pid text, cp int, ref text, verdict text, inliers int, ssim real,",
  "  changed real, regions text, ts real, primary key(pid, cp));",
  "create table outbox(id integer primary key, dest text, topic text, body blob, ts real);",
]));
add(P("Anything meant for the cloud is also inserted into the `outbox` table with a destination (`aws` or `ts`). A sender thread publishes AWS rows in batches of 100 at QoS 1 and deletes each row only after the broker acknowledges it. ThingSpeak rows are sent with one `bulk_update` call every 16 s, which fits the free tier's rate limit, and are deleted only when the call reports success. If Wi-Fi or a cloud service is down, rows simply wait. AWS telemetry is capped at the newest 5000 rows so the queue cannot fill the disk during a long outage. The database runs in WAL mode so the poller, the HTTP server and the sender can use it at the same time."));
add(H3("2.1.6 Cloud: ThingSpeak and AWS"));
add(P("**ThingSpeak** channel 3591852 receives rear, front, heading and a patrolling flag, and plots them. **AWS IoT Core** receives everything else. The rover is registered as the thing `rover` with an X.509 certificate. The certificate was issued from a signing request generated on the board, so the private key never left the device. The policy allows only client id `rover`, and only the `rover/*` topics and the rover's own shadow. The hub connects over MQTT with TLS on port 8883."));
add(Tab("AWS IoT topic rules", ["Rule", "SQL", "Action"], [
  ["verdicts_to_dynamodb", "SELECT * FROM 'rover/verdict'", "DynamoDB rover-verdicts (pid, cp)"],
  ["telemetry_to_dynamodb", "SELECT 'rover' AS device, *, floor(timestamp()/1000)+604800 AS expires FROM 'rover/telemetry'", "DynamoDB rover-telemetry (device, ts), 7-day TTL"],
  ["images_to_s3", "SELECT * FROM 'rover/img/+/+'", "S3 rover-patrol-<account>/<pid>/cp<n>.jpg"],
], [2400, 4400, 2838]));
add(P("The rules use an IAM role that can only call `PutItem` on the two tables and `PutObject` on the bucket. The bucket blocks all public access. The **Device Shadow** carries remote commands: setting `desired.patrol` in the AWS console makes the hub start a patrol and write back `reported`. A **budget** of US$1 per month emails an alert at 50% of actual or 100% of forecast spend. The whole setup is reproducible with one script, `iot/aws/setup.sh`."));
add(H3("2.1.7 Analytics I: change detection"));
add(P("At the end of a patrol the hub compares each checkpoint with the same checkpoint from the previous patrol. The rover never stops at exactly the same pose, so the images are aligned first:"));
add(B("**Sharpest frame:** the recorded frame with the highest variance of the Laplacian is used."));
add(B("**Alignment:** ORB features are matched with a ratio test (0.75), a homography H is fitted with RANSAC (3 px threshold), and the alignment is refined with ECC at half resolution [11]-[13]. The number of RANSAC inliers measures how well the views match. If alignment fails the verdict is REVIEW, never CLEAR."));
add(Eq("x_cur ≅ H · x_ref"));
add(B("**Lighting:** both images are equalised with CLAHE [14]."));
add(B("**Comparison:** local structural similarity is computed over 7x7 windows [15]:"));
add(Eq("SSIM(a, b) = ((2μ_aμ_b + C₁)(2σ_ab + C₂)) / ((μ_a² + μ_b² + C₁)(σ_a² + σ_b² + C₂))"));
add(P("A pixel counts as changed only if SSIM < 0.45 **and** the blurred absolute intensity difference is above 25 grey levels. SSIM alone flagged floor texture and camera noise; the intensity gate removed those false alarms. The border of the warped image is excluded with a 31x31 erosion. Connected regions are converted to physical area using the checkpoint distance d and the camera's 66° field of view over an image W pixels wide:"));
add(Eq("cm per pixel = 2 · (d / 10) · tan(33°) / W"));
add(P("Regions under 2 cm² are dropped. Any remaining region gives **REVIEW**, none gives **CLEAR**, and the first patrol at a checkpoint is the **BASELINE**. The verdict, inliers, SSIM, % area changed and region list are stored, published and sent to DynamoDB, and the annotated diff image goes to S3."));
add(H3("2.1.8 Analytics II: object detection and search"));
add(P("Search uses an open-vocabulary detector, YOLO-World v2 (medium) [16], exported to ONNX with our own vocabulary of 30 words (person, shoe, sneaker, sandal, bag, bottle, bucket, keys, wallet, fire extinguisher and others) and run with ONNX Runtime on the board's CPU at 320x320. It replaced a NanoDet-Plus COCO model after the benchmark in Section 3.2.3. Synonyms are grouped (shoe, sneaker, sandal, slipper, footwear), so a search for one accepts the others."));
add(P("The colour of each detection is the median hue, saturation and value of the central half of its box, after grey-world white balance to cancel warm room light. Colour only ranks candidates (+0.3 to the score); it never rejects a detection, because colour under indoor lighting is unreliable. The search runs as:"));
add(B("**Look:** grab a fresh frame and detect. This happens before any turn, so an object already in view is found at once."));
add(B("**Scan:** if the object is not found, turn 30° and look again, up to 13 times (a full circle)."));
add(B("**Approach:** turn by the heading error, drive 1.2 s with a firmware stop at 45 cm, and look again, up to 6 times. Re-looks prefer the detection nearest the image centre, so the rover stays on the same object:"));
add(Eq("e = (c_x − 0.5) × 66°   (turn if |e| > 8°)"));
add(B("**Stop:** when the front distance is at most 45 cm or the box covers more than 30% of the frame. The heading, distance and image are published on `rover/found` and stored in S3."));
add(P("The Android app shows live detection boxes over the video, refreshed from the hub. Tapping a box starts a search for that class and colour, so the rover drives to the object the operator pointed at."));
add(H3("2.1.9 Analytics III: data analysis with Pandas"));
add(P("A Jupyter notebook (`notebooks/analysis.ipynb`) loads a snapshot of the hub's SQLite database into Pandas DataFrames, converts timestamps to IST, and computes the telemetry rate and gaps, the share of valid sensor readings, the distribution of distances, gyro losses, the time spent in each state, patrol and search outcomes, the verdict statistics and the outbox backlog. Its results are in Section 3.2.2."));
add(H3("2.1.10 Syllabus coverage"));
add(Tab("Course modules covered by the project", ["Module / lab", "Where it is used"], [
  ["1. Sensor interfacing and monitoring", "HC-SR04 and MPU6050 on the UNO Q; 1 Hz telemetry; live dashboard gauges"],
  ["2. Device connectivity and messaging (Wi-Fi, MQTT)", "Mosquitto broker; topic design; retained status; MQTT/TLS to AWS"],
  ["3. Sensor-based automation", "Patrol and search state machines; firmware stop, slow-down and gyro turn"],
  ["4. IoT data storage and retrieval (SQL)", "SQLite tables for telemetry, patrols, verdicts and the outbox; SQL queries in the notebook"],
  ["5. Data processing with NumPy and Pandas", "Analysis notebook; NumPy in change detection and detection decoding"],
  ["6. Integrated IoT solution", "Sensors, edge vision, MQTT, storage, cloud and analytics in one system"],
  ["Lab: upload to ThingSpeak / AWS", "ThingSpeak bulk updates; AWS IoT Core rules to DynamoDB and S3"],
  ["Lab: Node-RED dashboard, inject, function nodes", "Dashboard 2.0 with gauges, charts, table, buttons and function nodes"],
  ["Lab: Node-RED to cloud over HTTP / MQTT", "rover/cmd from the dashboard; images served over HTTP; cloud over MQTT"],
], [4000, 5638]));

add(H1("Implementation & Testing"));
add(H2("3.1", "Experimental Setup"));
add(Tab("Hardware and software used", ["Item", "Details"], [
  ["Edge board", "Arduino UNO Q (STM32U585 MCU; Qualcomm QRB2210 with 4x Cortex-A53, 3.6 GB RAM, Debian)"],
  ["Camera", "Xiaomi Redmi A2 on USB, scrcpy server 5.0.1, H.264 640x480 at 15 fps"],
  ["Sensors and drive", "2x HC-SR04, MPU6050 clone, 4 DC gear motors, 2x L298N, battery pack"],
  ["Containers", "eclipse-mosquitto 2, nodered/node-red 4.0, hub on python:3.11-slim (OpenCV 4, ONNX Runtime, paho-mqtt 2)"],
  ["Cloud", "ThingSpeak channel 3591852; AWS ap-southeast-2: IoT Core, DynamoDB, S3, IAM, Budgets"],
  ["Analysis", "Python 3, Pandas, Matplotlib, Jupyter"],
  ["Network", "Wi-Fi; Tailscale for remote access to the board"],
], [2400, 7238]));
add(H2("3.2", "Results (Test Cases / Screenshots / Output)"));
add(H3("3.2.1 Functional test cases"));
add(Tab("Functional tests", ["Test", "Expected", "Result"], [
  ["Rover powered, dashboard open", "Gauges, heading and state update every second", "Pass"],
  ["Telemetry to ThingSpeak", "Channel fills with bulk updates", "Pass (843 entries)"],
  ["Verdict and telemetry to DynamoDB", "Items appear in both tables", "Pass (3 verdicts, 1676 telemetry items)"],
  ["Checkpoint and found images to S3", "Objects under <pid>/", "Pass (6 objects)"],
  ["Cloud rejects uploads (ThingSpeak rate limit)", "Rows stay in the outbox and are sent later", "Pass"],
  ["Set desired.patrol in the Device Shadow", "Patrol starts; reported state updated", "Pass"],
  ["Stationary patrol after moving a shoe", "REVIEW with the moved shoe highlighted", "Pass"],
  ["Stationary patrol with nothing changed", "CLEAR", "Not run"],
  ["Search for a person", "Rover turns to the person, drives up, stops at 45 cm", "Pass"],
  ["Tap a shoe in the app", "Rover goes to that shoe", "Pass"],
  ["Gyro unplugged during a patrol", "Patrol aborts with an error", "Not run"],
], [3500, 3900, 2238]));
add(P(`${Fig.ref()} shows a REVIEW verdict: between two patrols a shoe was moved and a bag was placed under the bed. The detector marks the new positions with their area. Small regions at the bottom-left edge are leftovers from the warp border.`));
add(Fig("iot-diff.png", "Change detection between two patrols (regions in cm²)", 0.7));
add(P(`${Fig.ref()} is the image the rover published on rover/found after the operator tapped a shoe in the app: the rover turned to it, drove up and stopped at close range. The same image is stored in S3.`));
add(Fig("iot-found.png", "Search result after tap-to-go on a shoe", 0.6));
add(H3("3.2.2 Data analysis"));
add(P("The snapshot analysed covers 1 h 29 min of operation on 22 November 2026."));
add(Tab("Summary of the recorded data", ["Measure", "Value"], [
  ["Telemetry rows", "5194"],
  ["Mean interval between samples", "1.03 s (target 1 s)"],
  ["Gaps over 10 s", "2 (80.8 s and 34.1 s, both during redeploys)"],
  ["Valid front / rear readings", "99.9% / 99.8%"],
  ["Mean valid front distance", "76.3 cm"],
  ["Gyro-lost samples", "0"],
  ["Patrols / searches", "2 patrols (done); 5 searches: 2 found, 1 lost, 2 failed (1 aborted, 1 approach timeout)"],
  ["Verdicts", "3 REVIEW: 2 with failed alignment (0 inliers), 1 with 326 inliers, SSIM 0.672, 12.8% changed, 4 regions"],
  ["Outbox backlog", "0 (everything delivered)"],
  ["AWS cost, November 2026", "US$0.00"],
], [3600, 6038]));
add(P(`${Fig.ref()} plots both distances over the session and ${Fig.ref(2)} shows the sensor validity and the front-distance distribution. Both sensors gave a valid reading in over 99.8% of samples after the echo gating was added. The two REVIEW verdicts with 0 inliers came from early tests where the camera saw mostly a featureless wall; the fail-safe correctly refused to call them CLEAR. ${Fig.ref(3)} shows the outcomes of patrols and searches.`));
add(Fig("iot-nb-dist.png", "Ultrasonic distances over the session", 1));
add(Fig("iot-nb-health.png", "Share of valid readings and front-distance histogram", 1));
add(Fig("iot-nb-outcomes.png", "Patrol and search outcomes", 0.55));
add(H3("3.2.3 Object detection benchmark"));
add(P(`Eight detectors were exported to ONNX and run on the board with the hub stopped, over five frames taken by the rover's own camera at floor level. ${Tab.ref()} gives the time per frame and ${Fig.ref()} shows the boxes each model drew. Small COCO models were fast but either invented objects (car, bird, bed) or missed most of them, and none of them has a shoe class. YOLO-World was the only family that found the shoes. Its scores also depend on the vocabulary: adding "sneaker" and dropping unrelated words raised the shoe score on one frame from 0.54 to 0.73.`));
add(Tab("Detector speed on the UNO Q and quality on rover frames", ["Model", "ms / frame", "Observation"], [
  ["NanoDet-Plus 416 (first version)", "288", "False positives: car, bird, bed"],
  ["SSD-MobileNet v2 300", "291", "False positives and misses"],
  ["PicoDet-S 416", "287", "False positives"],
  ["YOLO11n 320 / 416", "154 / 253", "Clean but misses most objects"],
  ["YOLOv8n 320 / 416", "185 / 321", "Similar to YOLO11n"],
  ["YOLO11s 320 / 416", "448 / 726", "Better recall; no shoe class"],
  ["YOLO-World s 320 / 416", "622 / 1030", "Finds shoes at 0.40-0.63"],
  ["YOLO-World m 320 (deployed)", "1590", "Shoes at 0.70-0.87; finds sandals"],
], [3600, 1700, 4338]));
add(Fig("iot-bench.png", "Detections of each model on the same rover frames", 0.62));
add(H3("3.2.4 Problems found and fixed"));
add(Tab("Problems found during development", ["Problem", "Fix"], [
  ["Stops overshot by up to 16 cm and turns by 31°, from Python and RPC latency", "Moved stopping, slow-down and turning into the firmware"],
  ["Ultrasonic crosstalk (shared trigger) and motor noise gave junk distances", "Echo gating: accept a reading only if it is close to the last one or three agree"],
  ["ThingSpeak accepted only some updates (15 s rate limit)", "One bulk_update call every 16 s from the outbox"],
  ["OpenCV could not decode the raw H.264 stream (missing PPS)", "Persistent ffmpeg decoder in the camera bridge serving the latest JPEG"],
  ["SSIM flagged floor texture as change", "A pixel must also differ by more than 25 grey levels; wider border mask"],
  ["A Docker rebuild pulled OpenCV 5.1, whose DNN engine crashed the detector", "Pinned OpenCV 4 and other dependencies; one lock around the model"],
  ["Search ignored a visible grey shoe: warm light made it 'orange' and colour was a hard filter", "White-balanced colour; colour now only ranks candidates"],
  ["Camera frames were dark indoors (mean brightness 92/255)", "scrcpy's 30 fps lock capped exposure; 15 fps raised it to 156/255"],
  ["Search 'lost' an object it had already reached", "Keep the last sighting as the result"],
], [5200, 4438]));

add(H1("Conclusion & Future Scope"));
add(H2("4.1", "Summary of Work and Achievements"));
add(P("The project delivers a complete IoT pipeline from sensors to cloud analytics on one low-cost edge board:"));
add(B("Autonomous patrol with firmware stopping and gyro turning, and an object search that drives up to a person or a shoe."));
add(B("Change detection that aligns checkpoint images across patrols and reports CLEAR, REVIEW or BASELINE with measured regions."));
add(B("Open-vocabulary object detection on the board's CPU, chosen by a benchmark of eight models on the rover's own frames."));
add(B("MQTT messaging, a Node-RED dashboard, and SQLite store-and-forward that delivered every record (outbox backlog 0)."));
add(B("ThingSpeak plus AWS IoT Core with X.509 identity, rules into DynamoDB and S3, a Device Shadow for remote patrols, and a budget, all at US$0.00 so far."));
add(B("A Pandas analysis showing 1.03 s sampling, over 99.8% valid sensor readings and no gyro losses in the recorded session."));
add(H2("4.2", "Impact on Society, Environmental Sustainability, Ethical Issues and Compliance"));
add(P("**Society and environment.** The rover gives security checks a durable, comparable record and can search a room before a person enters. It runs on a low-power board, reuses an old phone, and processes video at the edge, so only small images and records reach the cloud."));
add(P("**Ethics and compliance.** A camera rover that detects people must only be used where the operator is authorised, and people should be told that patrols record images. Video is never streamed to the cloud; only checkpoint and result images are stored, in a private bucket, and telemetry expires from DynamoDB after 7 days. The device has its own certificate with least-privilege permissions, and the cloud spend is capped by a budget alert."));
add(H2("4.3", "Limitations of the Work and Future Scope"));
add(B("**No position estimate:** the rover knows its heading but not its distance travelled. Wheel encoders would allow repeatable routes and maps."));
add(B("**Detection speed:** YOLO-World m takes 1.6 s per frame on the CPU, so live boxes refresh about once a second. A board with an NPU would allow real-time rates."));
add(B("**Battery monitoring:** not yet built; a resistor divider into an ADC pin would add battery voltage to the telemetry."));
add(B("**Evaluation size:** the recorded dataset covers one day. Longer runs with labelled changes would allow detection accuracy to be measured."));
add(B("**Under-vehicle inspection:** the original synopsis goal. It needs an upward camera and image stitching into a mosaic, on the same pipeline."));

finish({
  file: "IoT_Analytics_Report.docx",
  title: ["Undersight: An Autonomous Patrol Rover", "with Edge Vision and Cloud Analytics"],
  course: "Fundamental IoT Analytics Lab", code: "26B16CS315",
  members: MEMBERS, team: TEAM,
  refs: [
    "R. Buyya and A. V. Dastjerdi, Eds., _Internet of Things: Principles and Paradigms_. Amsterdam, The Netherlands: Elsevier/Morgan Kaufmann, 2016.",
    "D. Hanes, G. Salgueiro, P. Grossetete, R. Barton, and J. Henry, _IoT Fundamentals: Networking Technologies, Protocols, and Use Cases for the Internet of Things_. Indianapolis, IN, USA: Cisco Press, 2017.",
    "OASIS, \"MQTT Version 3.1.1,\" OASIS Standard, 2014. [Online]. Available: https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html",
    "Eclipse Foundation, \"Eclipse Mosquitto.\" [Online]. Available: https://mosquitto.org",
    "OpenJS Foundation, \"Node-RED.\" [Online]. Available: https://nodered.org",
    "Amazon Web Services, \"AWS IoT Core Developer Guide.\" [Online]. Available: https://docs.aws.amazon.com/iot/latest/developerguide/",
    "MathWorks, \"ThingSpeak documentation: Bulk-write JSON data.\" [Online]. Available: https://www.mathworks.com/help/thingspeak/bulkwritejsondata.html",
    "SQLite, \"Write-Ahead Logging.\" [Online]. Available: https://www.sqlite.org/wal.html",
    "W. McKinney, \"Data structures for statistical computing in Python,\" in _Proc. 9th Python in Science Conf._, 2010, pp. 56-61.",
    "Arduino, \"UNO Q user manual.\" [Online]. Available: https://docs.arduino.cc/hardware/uno-q/",
    "E. Rublee, V. Rabaud, K. Konolige, and G. Bradski, \"ORB: An efficient alternative to SIFT or SURF,\" in _Proc. IEEE ICCV_, 2011, pp. 2564-2571.",
    "M. A. Fischler and R. C. Bolles, \"Random sample consensus,\" _Commun. ACM_, vol. 24, no. 6, pp. 381-395, 1981.",
    "G. D. Evangelidis and E. Z. Psarakis, \"Parametric image alignment using enhanced correlation coefficient maximization,\" _IEEE Trans. Pattern Anal. Mach. Intell._, vol. 30, no. 10, pp. 1858-1865, 2008.",
    "K. Zuiderveld, \"Contrast limited adaptive histogram equalization,\" in _Graphics Gems IV_. San Diego, CA, USA: Academic Press, 1994, pp. 474-485.",
    "Z. Wang, A. C. Bovik, H. R. Sheikh, and E. P. Simoncelli, \"Image quality assessment: From error visibility to structural similarity,\" _IEEE Trans. Image Process._, vol. 13, no. 4, pp. 600-612, 2004.",
    "T. Cheng, L. Song, Y. Ge, W. Liu, X. Wang, and Y. Shan, \"YOLO-World: Real-time open-vocabulary object detection,\" in _Proc. IEEE/CVF CVPR_, 2024, pp. 16901-16911.",
    "Genymobile, \"scrcpy: Display and control your Android device.\" [Online]. Available: https://github.com/Genymobile/scrcpy",
  ],
  source: "Firmware: `rover/sketch/sketch.ino`. Rover app: `rover/python/main.py`. Camera bridge: `cam/cam.py`. Hub: `iot/hub/hub.py`, `iot/hub/detect.py`. Change detection: `vision/vision.py`. Stack: `iot/compose.yaml`, `iot/nodered/flows.json`. AWS setup: `iot/aws/setup.sh`. Analysis: `notebooks/analysis.ipynb`. Documentation: `docs/`.",
});
