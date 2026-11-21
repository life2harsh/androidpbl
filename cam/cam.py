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
ARGS = ("tunnel_forward=true audio=false control=true clipboard_autosync=false power_on=false cleanup=false video_source=camera camera_id=0 "
        "camera_size=640x480 camera_fps=30 video_codec=h264 video_bit_rate=1000000 "
        "video_codec_options=i-frame-interval=1 send_dummy_byte=false send_device_meta=false "
        "send_frame_meta=true")
JS = open("/cam/jmuxer.min.js", "rb").read()
IDLE = 10

cv = threading.Condition()
st = {"cfg": b"", "frame": b"", "key": False, "seq": 0, "viewers": 0, "torch": False, "ctl": None}
rec = {}


def rec_start(name):
    d = f"/scans/{name}"
    os.makedirs(d, exist_ok=True)
    p = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-use_wallclock_as_timestamps", "1", "-f", "h264", "-i", "-",
                          "-vf", "fps=10", "-q:v", "3", f"{d}/f_%05d.jpg"], stdin=subprocess.PIPE)
    json.dump({"start": time.time(), "fps": 10, "size": [640, 480]}, open(f"{d}/meta.json", "w"))
    rec.update(proc=p, dir=d, live=False)
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
    for _ in range(20):
        time.sleep(0.5)
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
        adb("wait-for-device")
        adb("push", "/scrcpy-server", JAR)
        adb("forward", "tcp:27183", "localabstract:scrcpy")
        p = subprocess.Popen(ADB + ["shell", f"CLASSPATH={JAR} app_process / com.genymobile.scrcpy.Server 5.0.1 {ARGS} camera_torch={str(st['torch']).lower()}"])
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
                        rec_feed(pf, d)
                    cv.notify_all()
                    idle = None if st["viewers"] else idle or time.time()
                if idle and time.time() - idle > IDLE:
                    break
        except Exception as e:
            print("[cam]", repr(e), flush=True)
        finally:
            c, st["ctl"] = st["ctl"], None
            if c:
                c.close()
            p.kill()
            adb("shell", "pkill", "-f", "com.genymobile")
            print("[cam] stopped", flush=True)
        time.sleep(1)


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
