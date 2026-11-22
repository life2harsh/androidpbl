import glob
import json
import os
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

import numpy as np

import cv2
import paho.mqtt.client as mqtt

from detect import Detector
from vision import compare, sharpest

ROVER = os.environ.get("ROVER", "http://127.0.0.1:8080")
CAM = os.environ.get("CAM", "http://127.0.0.1:8081")
SCANS = os.environ.get("SCANS", "/scans")
DATA = os.environ.get("DATA", "/data")
TS_KEY = os.environ.get("TS_KEY", "")
TS_CHANNEL = os.environ.get("TS_CHANNEL", "")
AWS = os.environ.get("AWS_ENDPOINT", "")
THING = os.environ.get("THING", "rover")
SHADOW = f"$aws/things/{THING}/shadow"
API = mqtt.CallbackAPIVersion.VERSION2

lock = threading.Lock()
db_ = sqlite3.connect(f"{DATA}/hub.db", check_same_thread=False)
db_.executescript("""
pragma journal_mode=wal;
create table if not exists telemetry(ts real, rear int, front int, hdg int, mode int, patrol text);
create table if not exists patrols(pid text primary key, legs int, state text, err text, ts real);
create table if not exists verdicts(pid text, cp int, ref text, verdict text, inliers int, ssim real,
  changed real, regions text, ts real, primary key(pid, cp));
create table if not exists outbox(id integer primary key, dest text, topic text, body blob, ts real);
""")


def db(q, a=()):
    with lock:
        r = db_.execute(q, a).fetchall()
        db_.commit()
        return r


def get(path):
    return urlopen(ROVER + path, timeout=3).read()


def start_patrol(legs):
    try:
        get(f"/patrol?legs={int(legs)}&stop=350")
    except OSError:
        pass


def on_local(c, u, m):
    try:
        cmd = json.loads(m.payload)
    except ValueError:
        return
    try:
        if cmd.get("patrol"):
            start_patrol(cmd["patrol"])
        elif cmd.get("search"):
            get(f"/search?cls={cmd['search']}&color={cmd.get('color', '')}")
    except OSError:
        pass


live_det = Detector(f"{DATA}/models/world_320.onnx", f"{DATA}/models/classes.txt", 3)
detector = Detector(f"{DATA}/models/world_416.onnx", f"{DATA}/models/classes.txt")
live = {"until": 0.0, "frame": None, "out": b'{"dets": []}'}
HUES = ((10, "red"), (22, "orange"), (35, "yellow"), (85, "green"), (130, "blue"), (160, "purple"), (180, "red"))


def colour(img, box):
    x, y, w, h = box
    roi = cv2.cvtColor(img[max(0, y + h // 4):y + 3 * h // 4, max(0, x + w // 4):x + 3 * w // 4], cv2.COLOR_BGR2HSV).reshape(-1, 3)
    if not len(roi):
        return "unknown"
    hh, s, v = np.median(roi, 0)
    if v < 50:
        return "black"
    if s < 40:
        return "white" if v > 170 else "grey"
    return next(n for t, n in HUES if hh < t)


def reader():
    while True:
        if time.time() > live["until"]:
            time.sleep(0.2)
            continue
        last = b""
        while time.time() < live["until"]:
            try:
                j = urlopen(CAM + "/live.jpg", timeout=5).read()
            except OSError:
                time.sleep(0.3)
                continue
            if j != last:
                last, live["frame"] = j, cv2.imdecode(np.frombuffer(j, np.uint8), cv2.IMREAD_COLOR)
            time.sleep(0.05)
        live["frame"] = None


def detector_loop():
    while True:
        f, live["frame"] = live["frame"], None
        if f is None:
            time.sleep(0.03)
            continue
        h, w = f.shape[:2]
        dets = [dict(d, colour=colour(f, d["box"]), box=[round(d["box"][0] / w, 3), round(d["box"][1] / h, 3), round(d["box"][2] / w, 3), round(d["box"][3] / h, 3)])
                for d in live_det(f, 0.3)]
        live["out"] = json.dumps({"ts": time.time(), "dets": dets}).encode()


def look(cls, sid, col=""):
    img = cv2.imdecode(np.frombuffer(urlopen(CAM + "/snap.jpg", timeout=10).read(), np.uint8), cv2.IMREAD_COLOR)
    hits = [d for d in detector(img) if d["cls"] == cls and (not col or colour(img, d["box"]) == col)]
    best = max(hits, key=lambda d: d["score"]) if hits else None
    r = {"sid": sid, "cls": cls, "colour": col, "found": bool(best), "ts": time.time()}
    if best:
        x, y, w, h = best["box"]
        r.update(score=best["score"], box=best["box"], cx=(x + w / 2) / img.shape[1], area=w * h / (img.shape[0] * img.shape[1]))
        cv2.rectangle(img, (x, y), (x + w, y + h), (0, 0, 255), 2)
        cv2.putText(img, f"{col} {cls} {best['score']:.2f}".strip(), (x, max(14, y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)
    os.makedirs(f"{SCANS}/{sid}", exist_ok=True)
    cv2.imwrite(f"{SCANS}/{sid}/last.jpg", img)
    if best:
        cv2.imwrite(f"{SCANS}/{sid}/hit.jpg", img)
    local.publish("rover/search", json.dumps(r))
    return r, img


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == "/dets":
                live["until"] = time.time() + 3
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(live["out"])
                return
            if u.path == "/classes":
                r = detector.names
            elif u.path == "/look":
                r, _ = look(q.get("cls", "person"), q.get("sid", "s"), q.get("color", ""))
            elif u.path == "/found":
                r = json.loads(q["r"])
                emit("rover/found", r)
                emit(f"rover/img/{r['sid']}/found", open(f"{SCANS}/{r['sid']}/hit.jpg", "rb").read())
            else:
                raise KeyError(u.path)
        except (OSError, KeyError, ValueError) as e:
            self.send_error(500, repr(e))
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(r).encode())


local = mqtt.Client(API, "hub")
local.on_connect = lambda c, *a: c.subscribe("rover/cmd")
local.on_message = on_local
local.connect_async("127.0.0.1")
local.loop_start()


def emit(topic, obj, cloud=True):
    body = obj if isinstance(obj, bytes) else json.dumps(obj).encode()
    if not isinstance(obj, bytes):
        local.publish(topic, body, retain=topic != "rover/telemetry")
    if cloud:
        db("insert into outbox(dest, topic, body, ts) values('aws', ?, ?, ?)", (topic, body, time.time()))


def on_shadow(c, u, m):
    d = json.loads(m.payload).get("state", {})
    if "patrol" in d:
        start_patrol(d.get("legs", 4))
        c.publish(SHADOW + "/update", json.dumps({"state": {"reported": {"patrol": d["patrol"]}}}), qos=1)


def cloud():
    if not AWS:
        return None
    c = mqtt.Client(API, THING)
    c.tls_set(f"{DATA}/certs/ca.pem", f"{DATA}/certs/cert.pem", f"{DATA}/certs/key.pem")
    c.on_connect = lambda c, *a: c.subscribe(SHADOW + "/update/delta", 1)
    c.on_message = on_shadow
    c.connect_async(AWS, 8883)
    c.loop_start()
    return c


def sender():
    aws, ts_at = cloud(), 0
    while True:
        sent = 0
        if aws and aws.is_connected():
            batch = [(i, aws.publish(topic, body, qos=1)) for i, topic, body in db("select id, topic, body from outbox where dest='aws' order by id limit 100")]
            done = []
            for i, info in batch:
                info.wait_for_publish(10)
                if not info.is_published():
                    break
                done.append((i,))
            with lock:
                db_.executemany("delete from outbox where id=?", done)
                db_.commit()
            sent = len(done)
        rows = db("select id, body, ts from outbox where dest='ts' order by id limit 900") if TS_KEY and time.time() - ts_at > 16 else []
        if rows:
            ts_at = time.time()
            ups = [dict(json.loads(b), created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))) for _, b, t in rows]
            req = Request(f"https://api.thingspeak.com/channels/{TS_CHANNEL}/bulk_update.json", json.dumps({"write_api_key": TS_KEY, "updates": ups}).encode(), {"Content-Type": "application/json"})
            try:
                if json.loads(urlopen(req, timeout=15).read()).get("success"):
                    db(f"delete from outbox where dest='ts' and id <= {rows[-1][0]}")
            except (OSError, ValueError):
                pass
        db("delete from outbox where id in (select id from outbox where dest='aws' and topic='rover/telemetry' order by id desc limit -1 offset 5000)")
        time.sleep(0.2 if sent else 2)


def analyse(p):
    pid, legs = p["id"], p["legs"]
    earlier = sorted({os.path.basename(d).rsplit("-cp", 1)[0] for d in glob.glob(f"{SCANS}/p*-cp*")} - {pid})
    earlier = [e for e in earlier if e < pid]
    for k in range(legs):
        cur = f"{SCANS}/{pid}-cp{k}"
        ref = next((e for e in reversed(earlier) if os.path.isdir(f"{SCANS}/{e}-cp{k}")), None)
        if not os.path.isdir(cur):
            continue
        img = sharpest(cur)
        if ref:
            r, vis = compare(sharpest(f"{SCANS}/{ref}-cp{k}"), img, dist_mm=350)
            if vis is not None:
                cv2.imwrite(f"{cur}/diff.jpg", vis)
        else:
            r, vis = {"verdict": "BASELINE", "inliers": 0, "regions": []}, None
        v = {"pid": pid, "cp": k, "ref": ref, "verdict": r["verdict"], "inliers": r["inliers"], "ssim": r.get("ssim"),
             "changed": r.get("changed_pct"), "regions": r["regions"], "ts": time.time()}
        db("insert or replace into verdicts values(?,?,?,?,?,?,?,?,?)",
           (pid, k, ref, v["verdict"], v["inliers"], v["ssim"], v["changed"], json.dumps(v["regions"]), v["ts"]))
        emit("rover/verdict", v)
        emit(f"rover/img/{pid}/{k}", cv2.imencode(".jpg", vis if vis is not None else img, [cv2.IMWRITE_JPEG_QUALITY, 70])[1].tobytes())


def main():
    threading.Thread(target=sender, daemon=True).start()
    threading.Thread(target=reader, daemon=True).start()
    threading.Thread(target=detector_loop, daemon=True).start()
    threading.Thread(target=ThreadingHTTPServer(("0.0.0.0", 8090), H).serve_forever, daemon=True).start()
    last, aws_at, ts_at, online = None, 0, 0, None
    while True:
        now = time.time()
        try:
            p = json.loads(get("/patrol"))
            rear, front, hdg, mode = map(int, get("/ping").split(b","))
            up = True
        except (OSError, ValueError):
            up = False
        if up != online:
            online = up
            emit("rover/status", {"online": up, "ts": now})
        if up:
            t = {"ts": now, "rear": rear, "front": front, "hdg": hdg / 10 if hdg > -99999 else None, "mode": mode, "patrol": p["state"]}
            emit("rover/telemetry", t, cloud=now - aws_at >= 10)
            db("insert into telemetry values(?,?,?,?,?,?)", (now, rear, front, hdg, mode, p["state"]))
            if now - aws_at >= 10:
                aws_at = now
                db("insert into outbox(dest, topic, body, ts) values('aws', ?, ?, ?)",
                   (SHADOW + "/update", json.dumps({"state": {"reported": {"online": True, "patrol_state": p["state"], "pid": p["id"]}}}).encode(), now))
            if now - ts_at >= 20:
                ts_at = now
                f = {"field1": rear, "field2": front, "field3": t["hdg"] if t["hdg"] is not None else "", "field4": int(p["state"] in ("drive", "capture", "turn", "selfcheck"))}
                db("insert into outbox(dest, topic, body, ts) values('ts', '', ?, ?)", (json.dumps(f).encode(), now))
            key = (p["id"], p["state"])
            if key != last:
                last = key
                if p["id"]:
                    db("insert or replace into patrols values(?,?,?,?,?)", (p["id"], p["legs"], p["state"], p["err"], now))
                    emit("rover/patrol", p)
                    if p["state"] == "done":
                        threading.Thread(target=analyse, args=(p,), daemon=True).start()
        time.sleep(max(0.0, 1 - (time.time() - now)))


if __name__ == "__main__":
    main()
