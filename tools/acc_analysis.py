import json
import sys

import numpy as np

G = 9.81


def analyse(r):
    L = r["log"]
    t = np.array([x[0] for x in L])
    a = np.array([x[2:5] for x in L], float)
    w = np.array([x[5:8] for x in L], float)
    moving = np.array([x[9] != "" for x in L])
    rest = np.arange(len(L)) < np.argmax(moving)
    scale = G / np.linalg.norm(a[rest].mean(0))
    f = a * scale
    w = np.radians((w - w[rest].mean(0)) / 131.0)
    dt = np.diff(t, prepend=t[0])
    g = f[rest].mean(0)
    grav = np.empty_like(f)
    for i in range(len(f)):
        g = g - np.cross(w[i], g) * dt[i]
        grav[i] = g
    out = {}
    for name, lin in (("no tilt fix", f - f[rest].mean(0)), ("gyro tilt fix", f - grav)):
        up = f[rest].mean(0) / np.linalg.norm(f[rest].mean(0))
        h = lin - np.outer(lin @ up, up)
        seg = slice(np.argmax(moving), len(L))
        u, s_, vt = np.linalg.svd(h[seg] - h[seg].mean(0), full_matrices=False)
        ax = vt[0]
        acc = h @ ax
        v = np.cumsum(acc * dt)
        x_raw = np.cumsum(v * dt)
        i0, i1 = np.argmax(moving), len(L) - 1
        ramp = np.zeros(len(L))
        ramp[i0:] = np.linspace(0, v[i1] - v[i0 - 1], i1 - i0 + 1)
        v_z = v - ramp - v[i0 - 1]
        v_z[:i0] = 0
        x_z = np.cumsum(v_z * dt)
        out[name] = (abs(x_raw[-1] - x_raw[i0 - 1]) * 100, abs(x_z[-1]) * 100, abs(v[i1] - v[i0 - 1]))
    return abs(r["f1"] - r["f0"]) / 10, out


if __name__ == "__main__":
    for path in sys.argv[1:]:
        sonar, res = analyse(json.load(open(path)))
        print(f"{path}: sonar {sonar:.1f} cm")
        for k, (raw, z, vend) in res.items():
            print(f"  {k:14s} raw {raw:7.1f} cm   zero-speed reset {z:6.1f} cm   leftover speed {vend:.2f} m/s")
