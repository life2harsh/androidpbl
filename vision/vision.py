import argparse
import glob
import json
import math
import os

import cv2
import numpy as np

ORB = cv2.ORB_create(3000)
MATCH = cv2.BFMatcher(cv2.NORM_HAMMING)
CLAHE = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))


def sharpest(d):
    fs = sorted(glob.glob(os.path.join(d, "*.jpg")))
    if not fs:
        raise FileNotFoundError(d)
    return max((cv2.imread(f, cv2.IMREAD_GRAYSCALE) for f in fs), key=lambda g: cv2.Laplacian(g, cv2.CV_64F).var())


def align(ref, cur):
    ka, da = ORB.detectAndCompute(ref, None)
    kb, db = ORB.detectAndCompute(cur, None)
    if da is None or db is None:
        return None, 0
    good = [m for m, n in (p for p in MATCH.knnMatch(db, da, k=2) if len(p) == 2) if m.distance < 0.75 * n.distance]
    if len(good) < 12:
        return None, len(good)
    src = np.float32([kb[m.queryIdx].pt for m in good])
    dst = np.float32([ka[m.trainIdx].pt for m in good])
    H, inl = cv2.findHomography(src, dst, cv2.RANSAC, 3.0)
    if H is None:
        return None, 0
    s = 0.5
    S = np.diag([s, s, 1.0])
    W = (S @ np.linalg.inv(H) @ np.linalg.inv(S)).astype(np.float32)
    try:
        _, W = cv2.findTransformECC(cv2.resize(ref, None, fx=s, fy=s), cv2.resize(cur, None, fx=s, fy=s), W,
                                    cv2.MOTION_HOMOGRAPHY, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 50, 1e-5), None, 5)
        H = np.linalg.inv(np.linalg.inv(S) @ W @ S)
    except cv2.error:
        pass
    return H, int(inl.sum())


def ssim(a, b):
    a, b = a.astype(np.float32), b.astype(np.float32)
    g = lambda x: cv2.GaussianBlur(x, (11, 11), 1.5)
    ma, mb = g(a), g(b)
    va, vb, cab = g(a * a) - ma * ma, g(b * b) - mb * mb, g(a * b) - ma * mb
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    return (2 * ma * mb + c1) * (2 * cab + c2) / ((ma * ma + mb * mb + c1) * (va + vb + c2))


def compare(ref, cur, dist_mm=400, fov_deg=66, thresh=0.45, min_cm2=2.0):
    h, w = ref.shape
    H, inliers = align(ref, cur)
    if H is None:
        return {"verdict": "REVIEW", "reason": "no_alignment", "inliers": inliers, "regions": []}, None
    warped = cv2.warpPerspective(cur, H, (w, h))
    valid = cv2.erode(cv2.warpPerspective(np.full_like(cur, 255), H, (w, h)), np.ones((15, 15), np.uint8)) > 0
    s = ssim(CLAHE.apply(ref), CLAHE.apply(warped))
    mask = ((s < thresh) & valid).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    cm_px = 2 * dist_mm / 10 * math.tan(math.radians(fov_deg / 2)) / w
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    regions = [{"x": int(x), "y": int(y), "w": int(bw), "h": int(bh), "cm2": round(float(a) * cm_px * cm_px, 1)}
               for x, y, bw, bh, a in stats[1:n] if a * cm_px * cm_px >= min_cm2]
    regions.sort(key=lambda r: -r["cm2"])
    r = {"verdict": "REVIEW" if regions else "CLEAR", "inliers": inliers,
         "ssim": round(float(s[valid].mean()), 3), "changed_pct": round(100 * float((mask > 0).sum()) / max(1, int(valid.sum())), 2),
         "regions": regions}
    vis = cv2.cvtColor(warped, cv2.COLOR_GRAY2BGR)
    for g in regions:
        cv2.rectangle(vis, (g["x"], g["y"]), (g["x"] + g["w"], g["y"] + g["h"]), (0, 0, 255), 2)
        cv2.putText(vis, f'{g["cm2"]} cm2', (g["x"], max(12, g["y"] - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1)
    return r, vis


def main():
    p = argparse.ArgumentParser()
    p.add_argument("ref")
    p.add_argument("cur")
    p.add_argument("--dist-mm", type=float, default=400)
    p.add_argument("--out")
    a = p.parse_args()
    r, vis = compare(sharpest(a.ref), sharpest(a.cur), a.dist_mm)
    if a.out and vis is not None:
        cv2.imwrite(a.out, vis)
    print(json.dumps(r))


if __name__ == "__main__":
    main()
