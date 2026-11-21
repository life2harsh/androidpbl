import cv2
import numpy as np
import pytest

from vision import compare, ssim

H0 = np.array([[1.0, 0.02, 6], [-0.015, 1.0, -4], [1e-5, 0, 1]])


@pytest.fixture(scope="module")
def scene():
    rng = np.random.default_rng(7)
    g = cv2.GaussianBlur(rng.integers(0, 255, (480, 640)).astype(np.uint8), (5, 5), 0)
    for _ in range(40):
        x, y = rng.integers(0, 600), rng.integers(0, 440)
        cv2.circle(g, (int(x), int(y)), int(rng.integers(5, 30)), int(rng.integers(0, 255)), -1)
    return g


def view(g):
    return cv2.warpPerspective(g, H0, (640, 480), borderMode=cv2.BORDER_REFLECT)


def test_ssim_identical_is_one(scene):
    assert ssim(scene, scene).mean() == pytest.approx(1.0, abs=1e-4)


def test_shifted_view_is_clear(scene):
    r, _ = compare(scene, view(scene))
    assert r["verdict"] == "CLEAR" and r["inliers"] > 50


def test_lighting_change_is_clear(scene):
    r, _ = compare(scene, cv2.convertScaleAbs(view(scene), alpha=0.8, beta=25))
    assert r["verdict"] == "CLEAR"


def test_new_object_is_flagged(scene):
    cur = scene.copy()
    cv2.rectangle(cur, (300, 200), (360, 250), 255, -1)
    r, vis = compare(scene, view(cur))
    assert r["verdict"] == "REVIEW" and vis is not None
    x, y = r["regions"][0]["x"], r["regions"][0]["y"]
    assert 280 < x < 340 and 180 < y < 230


def test_small_speck_ignored(scene):
    cur = scene.copy()
    cv2.circle(cur, (320, 240), 2, 255, -1)
    assert compare(scene, view(cur))[0]["verdict"] == "CLEAR"


def test_unrelated_scene_needs_review(scene):
    other = np.random.default_rng(1).integers(0, 255, (480, 640)).astype(np.uint8)
    assert compare(scene, other)[0]["verdict"] == "REVIEW"
