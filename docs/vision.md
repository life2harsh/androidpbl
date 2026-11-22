# Vision and detection

## Change detection (`vision/vision.py`)

Checkpoint images from two patrols are never taken from exactly the same pose, so the pipeline aligns them before comparing.

1. **Sharpest frame:** pick the frame with the highest Laplacian variance from the 1.6 s recording.
2. **Align:** ORB features with a ratio test, then a RANSAC homography, refined with ECC. `inliers` is the RANSAC inlier count. If alignment fails, the verdict is **REVIEW** (fail safe, never CLEAR).
3. **Normalise lighting:** CLAHE on both grey images.
4. **Compare:** a pixel counts as changed only if local SSIM < 0.45 **and** the blurred absolute intensity difference > 25. The second test removes floor texture and noise that SSIM alone flags. Warp borders are excluded (31×31 erosion of the valid mask).
5. **Regions:** contours larger than 2 cm² (converted using the checkpoint distance and the 66° FOV) become regions. Any region gives **REVIEW**; none gives **CLEAR**. The first patrol at a checkpoint is the **BASELINE**.

Output: the verdict, inliers, SSIM, % area changed, regions, and a `diff.jpg` overlay. Tests: `python vision/test_vision.py` (6 cases).

## Object detection (`iot/hub/detect.py`)

- **Model:** YOLO-World v2 **m** (YOLOv8m backbone) at 320 px, an open-vocabulary detector. The vocabulary is fixed when exporting to ONNX, so it detects our own 30 words, including shoe, sneaker, sandal, slipper, keys, wallet, bucket and fire extinguisher. The list is in `iot/data/models/classes2.txt` and served at hub `/classes`. Changing it means re-exporting (`YOLOWorld("yolov8m-worldv2.pt").set_classes([...])`, then `export(format="onnx", imgsz=320, opset=12)`).
- **The word list matters:** YOLO-World's scores depend on which words it's given. Adding "sneaker" and trimming unrelated words raised the shoe score from 0.54 to 0.73 on the same frame.
- **Synonym groups:** a search for any of shoe / sneaker / sandal / slipper / footwear accepts the others, and the same goes for bag / backpack.
- **Runtime:** ONNX Runtime on the CPU, about 1.6 s per frame on the UNO Q. One model serves both live boxes and search. OpenCV DNN can't load YOLO-World.
- **Benchmark** on the UNO Q, using rover frames (boxes drawn in `model-benchmark.jpg`):

| Model | ms/frame | Notes |
|---|---|---|
| NanoDet-Plus 416 (first version) | 288 | many false positives (car, bird, bed) |
| SSD-MobileNet v2 300 | 291 | false positives, misses |
| PicoDet-S 416 | 287 | false positives |
| YOLO11n 320 / 416 | 154 / 253 | clean but misses most objects; no shoe class |
| YOLOv8n 320 / 416 | 185 / 321 | similar to YOLO11n |
| YOLO11s 320 / 416 | 448 / 726 | better recall; no shoe class |
| YOLO-World s 320 / 416 | 622 / 1030 | finds shoes (0.4–0.6) |
| YOLO-World l 416 / 640 | (laptop test) | no better than m on our frames |
| **YOLO-World m 320** | **1590** | shoes 0.70–0.87, finds sandals; best overall |

- **Colour:** the median HSV of the central half of each box. Low value → black; low saturation → white/grey; otherwise hue bins for red, orange, yellow, green, blue and purple. This lets a search target be "red backpack" or "white person".
- **Camera exposure:** scrcpy's `camera_fps` caps exposure time, and the camera delivers fewer frames than requested indoors. Measured at night (brightness / delivered fps): 15 → 127 / 10.5, 20 → 130 / 14.8, 24 → 92 / 19.7, 30 → 53 / 27.3. The bridge uses 20: same brightness as 15 with 40% more frames.
- **Live path:** the cam bridge keeps one ffmpeg decoder running (`/live.jpg`, about 0.2 s old). The hub detector loop runs only while someone polls `/dets` (it stays alive 3 s after the last poll), so it costs nothing when idle.
- **App:** draws the boxes over the video (the target class in red). Tapping a box sends `/search` with that box's class and colour, and the rover goes to it. Long-pressing FIND picks the class and colour from a list.

Limits: live boxes refresh about once a second, and small objects beyond about 2 m are still often missed.
