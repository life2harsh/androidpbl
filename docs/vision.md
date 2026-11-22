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

- **Model:** YOLO-World v2 (YOLOv8s backbone), an open-vocabulary detector. The vocabulary is fixed when exporting to ONNX, so it detects our own 40 words, including shoe, sandal, slipper, keys, wallet, bucket and fire extinguisher, which plain COCO models can't. The list is in `iot/data/models/classes.txt` and served at hub `/classes`. Changing it means re-exporting the model (`YOLOWorld("yolov8s-worldv2.pt").set_classes([...])`, then `export(format="onnx", imgsz=..., opset=12)`).
- **Runtime:** ONNX Runtime on the CPU. OpenCV DNN can't load YOLO-World's text-embedding MatMul.
- **Two sizes:** 320 px for live boxes (about 0.6 s per frame) and 416 px for search looks (about 1 s per frame, more accurate on small objects).
- **Benchmark** on the UNO Q, using rover frames (``compare.jpg` in the commit notes`):

| Model | ms/frame | Notes |
|---|---|---|
| NanoDet-Plus 416 (previous) | 288 | many false positives (car, bird, bed) |
| SSD-MobileNet v2 300 | 291 | false positives, misses |
| PicoDet-S 416 | 287 | false positives |
| YOLO11n 320 / 416 | 154 / 253 | clean but misses most objects; no shoe class |
| YOLOv8n 320 / 416 | 185 / 321 | similar to YOLO11n |
| YOLO11s 320 / 416 | 448 / 726 | better recall; no shoe class |
| **YOLO-World 320 / 416** | **622 / 1030** | finds shoes (0.4–0.63), person, bag, bucket; fewest wrong labels |

- **Colour:** the median HSV of the central half of each box. Low value → black; low saturation → white/grey; otherwise hue bins for red, orange, yellow, green, blue and purple. This lets a search target be "red backpack" or "white person".
- **Live path:** the cam bridge keeps one ffmpeg decoder running (`/live.jpg`, about 0.2 s old). The hub detector loop runs only while someone polls `/dets` (it stays alive 3 s after the last poll), so it costs nothing when idle.
- **App:** draws the boxes over the video (the target class in red). Tapping a box sends `/search` with that box's class and colour, and the rover goes to it. Long-pressing FIND picks the class and colour from a list.

Limits: live boxes refresh about once a second, and small objects beyond about 2 m are still often missed.
