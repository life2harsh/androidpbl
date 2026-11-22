import json
import os
import re
import socket
import struct
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ADB = ["adb", "-s", "HMCQEY89PNEAC66X"]
JAR = "/data/local/tmp/scrcpy-server.jar"
ARGS = ("tunnel_forward=true audio=false control=true clipboard_autosync=false power_on=false cleanup=false video_source=camera "
        "camera_size=640x480 camera_fps=15 video_codec=h264 video_bit_rate=1000000 "
        "video_codec_options=i-frame-interval=1 send_dummy_byte=false send_device_meta=false "
        "send_frame_meta=true")
JS = open("/cam/jmuxer.min.js", "rb").read()
IDLE = 10

cv = threading.Condition()
st = {"cfg": b"", "frame": b"", "key": False, "seq": 0, "viewers": 0, "torch": False, "ctl": None, "kf": b"", "kseq": 0}
rec = {}
dec = {"proc": None, "jpg": b"", "until": 0.0, "live": False}


def dec_read(p):
    buf = b""
    while chunk := p.stdout.read(65536):
        buf += chunk
        while (e := buf.find(b"\xff\xd9")) >= 0:
            dec["jpg"], buf = buf[buf.find(b"\xff\xd8"):e + 2], buf[e + 2:]


def dec_feed(pf, d):
    p = dec["proc"]
    if p and time.time() > dec["until"]:
        dec["proc"] = None
        st["viewers"] -= 1
        p.stdin.close()
        return
    if not p or not (dec["live"] or pf >> 61 & 1):
        return
    try:
        if not dec["live"]:
            p.stdin.write(st["cfg"][12:])
            dec["live"] = True
        p.stdin.write(d[12:])
    except OSError:
        pass


def dec_start():
    dec["until"] = time.time() + 3
    if not dec["proc"]:
        p = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-fflags", "nobuffer", "-flags", "low_delay", "-probesize", "32", "-analyzeduration", "0",
                              "-use_wallclock_as_timestamps", "1", "-f", "h264", "-i", "-",
                              "-threads", "1", "-vf", "fps=8", "-f", "image2pipe", "-flush_packets", "1", "-c:v", "mjpeg", "-q:v", "5", "-"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, bufsize=0)
        threading.Thread(target=dec_read, args=(p,), daemon=True).start()
        dec.update(proc=p, live=False, jpg=b"")
        st["viewers"] += 1
CFG = "/scans/cam.json"
try:
    cfg = json.load(open(CFG))
except (OSError, ValueError):
    cfg = {"rot": 180, "id": 0}


def rec_start(name):
    d = f"/scans/{name}"
    os.makedirs(d, exist_ok=True)
    p = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-use_wallclock_as_timestamps", "1", "-f", "h264", "-i", "-",
                          "-vf", "fps=10", "-q:v", "3", f"{d}/f_%05d.jpg"], stdin=subprocess.PIPE)
    json.dump({"start": time.time(), "fps": 10, "size": [640, 480]}, open(f"{d}/meta.json", "w"))
    rec.update(proc=p, dir=d, live=False)
    try:
        st["ctl"] and st["ctl"].sendall(bytes([17]))
    except OSError:
        pass
    st["viewers"] += 1


def rec_stop():
    if rec:
        st["viewers"] -= 1
        p = rec.pop("proc")
        p.stdin.close()
        p.wait()
        d = rec.pop("dir")
        subprocess.run(["chown", "-R", "1000:1000", d])
        rec.clear()
        return len([f for f in os.listdir(d) if f.endswith(".jpg")])
    return 0


def rec_feed(pf, d):
    if not rec or not (rec["live"] or pf >> 61 & 1):
        return
    try:
        if not rec["live"]:
            rec["proc"].stdin.write(st["cfg"][12:])
            rec["live"] = True
        rec["proc"].stdin.write(d[12:])
    except OSError:
        pass


def recvn(s, n):
    b = bytearray()
    while len(b) < n:
        d = s.recv(n - len(b))
        if not d:
            raise EOFError
        b += d
    return bytes(b)


def connect():
    for _ in range(50):
        time.sleep(0.2)
        socks = []
        try:
            socks = [socket.create_connection(("127.0.0.1", 27183), timeout=5) for _ in range(2)]
            recvn(socks[0], 4)
            return socks
        except (OSError, EOFError):
            for x in socks:
                x.close()
    raise TimeoutError("scrcpy server not reachable")


def adb(*a):
    subprocess.run(ADB + list(a), capture_output=True)


def run():
    while True:
        with cv:
            cv.wait_for(lambda: st["viewers"] > 0)
        if not st.get("pushed"):
            adb("wait-for-device")
            adb("push", "/scrcpy-server", JAR)
            adb("forward", "tcp:27183", "localabstract:scrcpy")
            st["pushed"] = True
        p = subprocess.Popen(ADB + ["shell", f"CLASSPATH={JAR} app_process / com.genymobile.scrcpy.Server 5.0.1 {ARGS} camera_id={cfg['id']} capture_orientation={cfg['rot']} camera_torch={str(st['torch']).lower()}"])
        idle = None
        try:
            s, st["ctl"] = connect()
            print("[cam] streaming", flush=True)
            while True:
                h = recvn(s, 12)
                if h[0] & 0x80:
                    continue
                pf, n = struct.unpack(">QI", h)
                d = h + recvn(s, n)
                with cv:
                    if pf >> 62 & 1:
                        st["cfg"] = d
                    else:
                        st.update(frame=d, key=bool(pf >> 61 & 1), seq=st["seq"] + 1)
                        if st["key"]:
                            st.update(kf=d, kseq=st["kseq"] + 1)
                        rec_feed(pf, d)
                        dec_feed(pf, d)
                    cv.notify_all()
                    idle = None if st["viewers"] else idle or time.time()
                if idle and time.time() - idle > IDLE:
                    break
        except Exception as e:
            st["pushed"] = isinstance(e, EOFError)
            print("[cam]", repr(e), flush=True)
        finally:
            c, st["ctl"] = st["ctl"], None
            if c:
                c.close()
            p.kill()
            adb("shell", "pkill", "-f", "com.genymobile")
            print("[cam] stopped", flush=True)
        time.sleep(0.2)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def head(self, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self):
        if self.path == "/jmuxer.js":
            self.head("text/javascript")
            self.wfile.write(JS)
        elif self.path == "/live.jpg":
            with cv:
                dec_start()
                cv.notify_all()
            if dec["jpg"]:
                self.head("image/jpeg")
                self.wfile.write(dec["jpg"])
            else:
                self.send_error(503)
        elif self.path == "/snap.jpg":
            with cv:
                st["viewers"] += 1
                cv.notify_all()
                n = st["kseq"]
                ok = cv.wait_for(lambda: st["kseq"] > n, timeout=8)
                st["viewers"] -= 1
                data = st["cfg"][12:] + st["kf"][12:]
            jpg = ok and subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "h264", "-i", "-", "-frames:v", "1", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "3", "-"],
                                        input=data, capture_output=True).stdout
            if jpg:
                self.head("image/jpeg")
                self.wfile.write(jpg)
            else:
                self.send_error(503)
        elif m := re.fullmatch(r"/cam(/rot|/switch)?", self.path):
            if m[1]:
                cfg["rot" if m[1] == "/rot" else "id"] ^= 180 if m[1] == "/rot" else 1
                json.dump(cfg, open(CFG, "w"))
                threading.Thread(target=adb, args=("shell", "pkill", "-f", "com.genymobile"), daemon=True).start()
            self.head("application/json")
            self.wfile.write(json.dumps(cfg).encode())
        elif m := re.fullmatch(r"/torch/([01])", self.path):
            st["torch"] = m[1] == "1"
            try:
                st["ctl"] and st["ctl"].sendall(bytes([18, st["torch"]]))
            except OSError:
                pass
            self.head("application/json")
            self.wfile.write(json.dumps({"torch": st["torch"]}).encode())
        elif self.path.startswith("/rec"):
            m = re.fullmatch(r"/rec/start/([\w-]{1,40})", self.path)
            with cv:
                if m and not rec:
                    rec_start(m[1])
                    cv.notify_all()
                    r = {"rec": m[1]}
                elif self.path == "/rec/stop":
                    r = {"frames": rec_stop()}
                else:
                    r = {"rec": rec and os.path.basename(rec["dir"])}
            self.head("application/json")
            self.wfile.write(json.dumps(r).encode())
        elif self.path == "/v":
            self.head("application/octet-stream")
            with cv:
                st["viewers"] += 1
                cv.notify_all()
                last = st["seq"]
            sent, live = None, False
            try:
                while True:
                    with cv:
                        if not cv.wait_for(lambda: st["seq"] != last, timeout=5):
                            continue
                        live = live and st["seq"] == last + 1
                        last, f, k, c = st["seq"], st["frame"], st["key"], st["cfg"]
                    if not (live or k):
                        continue
                    if not live or c is not sent:
                        self.wfile.write(c)
                        sent = c
                    live = True
                    self.wfile.write(f)
            except OSError:
                pass
            finally:
                with cv:
                    st["viewers"] -= 1
        else:
            self.send_error(404)


threading.Thread(target=run, daemon=True).start()
ThreadingHTTPServer(("0.0.0.0", 8081), H).serve_forever()
