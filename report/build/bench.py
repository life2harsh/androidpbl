import json, statistics as st, struct, sys, time, urllib.request

host = sys.argv[1] if len(sys.argv) > 1 else "100.94.97.102"
out = __import__("os").path.dirname(__import__("os").path.abspath(__file__)) + "/../figures/bench.json"
try:
    res = json.load(open(out))
except FileNotFoundError:
    res = {}


def get(path, port=8080):
    with urllib.request.urlopen(f"http://{host}:{port}{path}", timeout=2) as r:
        return r.read()


def rtt(path, n=200):
    ts = []
    for _ in range(n):
        t = time.perf_counter()
        get(path)
        ts.append((time.perf_counter() - t) * 1000)
        time.sleep(0.02)
    ts.sort()
    return {"n": n, "median": round(st.median(ts), 1), "p95": round(ts[int(n * 0.95) - 1], 1)}


res["ping"] = rtt("/ping")
res["drive"] = rtt("/d?l=0&r=0")

up, front = [], []
for _ in range(100):
    u, f, *_ = map(int, get("/ping").split(b","))
    if u > 0: up.append(u)
    if f > 0: front.append(f)
    time.sleep(0.1)
res["sonar"] = {k: {"n": len(x), "mean": round(st.mean(x)), "std": round(st.pstdev(x), 1)} for k, x in (("up", up), ("front", front)) if x}

get("/cal")
time.sleep(3)
hd = []
t0 = time.time()
while time.time() - t0 < 60:
    h = int(get("/ping").split(b",")[2])
    if h > -99999: hd.append(h / 10)
    time.sleep(1)
if hd:
    res["drift"] = {"secs": 60, "max_deg": round(max(abs(x) for x in hd), 1)}

t = time.perf_counter()
s = urllib.request.urlopen(f"http://{host}:8081/v", timeout=5)
frames, nbytes, first = 0, 0, None
while time.perf_counter() - t < 12:
    pf, n = struct.unpack(">QI", s.read(12))
    s.read(n)
    if pf >> 62 & 1: continue
    first = first or (time.perf_counter() - t) * 1000
    if first and time.perf_counter() - t > 2: frames += 1; nbytes += n
s.close()
res["video"] = {"first_ms": round(first), "fps": round(frames / 10, 1), "kbps": round(nbytes * 8 / 10 / 1000)}

json.dump(res, open(out, "w"), indent=1)
print(json.dumps(res, indent=1))
