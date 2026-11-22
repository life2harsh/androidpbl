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

- **Model:** NanoDet-Plus 416×416 ONNX (OpenCV model zoo), 80 COCO classes, run with OpenCV DNN on the CPU. It takes about 0.18 s per frame on the UNO Q. YOLOX-S took 2.6 s, so it was rejected.
- **Decoding:** letterbox, mean/std normalise, three strides (8/16/32), distribution-focal regression (softmax over 8 bins), score > 0.4, NMS 0.6.
- **Colour:** the median HSV of the central half of each box. Low value → black; low saturation → white/grey; otherwise hue bins for red, orange, yellow, green, blue and purple. This lets a search target be "red backpack" or "white person".
- **Live path:** the cam bridge keeps one ffmpeg decoder running (`/live.jpg`, about 0.2 s old). The hub detector loop runs only while someone polls `/dets` (it stays alive 3 s after the last poll), so it costs nothing when idle.
- **App:** draws the boxes over the video (the target class in red). Tapping a box sends `/search` with that box's class and colour, and the rover goes to it. Long-pressing FIND picks the class and colour from a list.

Limits: COCO has no shoe class, and small objects beyond about 2 m are missed at 416 px.
