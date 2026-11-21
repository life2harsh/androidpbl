import json
import threading
import time
from urllib.request import urlopen
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from arduino.app_utils import App, Bridge

PORT = 8080
STALE = 0.4
CAM = "http://172.17.0.1:8081"
CRUISE, SPIN = 170, 150

state = {"l": 0, "r": 0, "ts": 0.0}
test = {"m": -1, "v": 0, "until": 0.0}
lock = threading.Lock()
hits = 0
sense = (-1, -1, -99999, -1)
auto = {"on": False, "seen": 0.0}
want_cal = False
patrol_st = {"state": "idle", "id": "", "cp": -1, "legs": 0, "err": ""}
cmd = None
RUNNING = ("selfcheck", "drive", "capture", "turn")


def cam(path):
    try:
        return json.loads(urlopen(CAM + path, timeout=3).read())
    except (OSError, ValueError):
        return {}


def wait(cond, limit):
    t = time.time()
    while not cond():
        if patrol_st["state"] == "abort":
            raise RuntimeError("aborted")
        if time.time() - t > limit:
            raise RuntimeError("timeout in " + patrol_st["state"])
        time.sleep(0.05)


def spin(deg, d=1):
    global cmd
    h0 = sense[2]
    cmd = ("lr", d * SPIN, -d * SPIN)
    wait(lambda: abs(sense[2] - h0) >= deg * 10, 4)
    cmd = ("lr", 0, 0)
    time.sleep(0.4)


def warm(pid):
    try:
        with urlopen(CAM + "/v", timeout=5) as r:
            while patrol_st["id"] == pid and patrol_st["state"] in RUNNING:
                r.read(4096)
    except OSError:
        pass


def patrol(legs, stop_mm):
    global cmd
    pid = time.strftime("p%Y%m%d-%H%M%S")
    patrol_st.update(state="selfcheck", id=pid, cp=-1, legs=legs, err="")
    threading.Thread(target=warm, args=(pid,), daemon=True).start()
    try:
        if sense[2] <= -99999:
            raise RuntimeError("no gyro")
        spin(20)
        spin(20, -1)
        for k in range(legs):
            patrol_st.update(state="drive", cp=k)
            Bridge.notify("stopmm", stop_mm)
            cmd = ("hold", CRUISE)
            wait(lambda: 0 <= sense[1] <= stop_mm, 30)
            cmd = ("lr", 0, 0)
            patrol_st["state"] = "capture"
            cam("/torch/1")
            time.sleep(0.8)
            cam("/rec/start/%s-cp%d" % (pid, k))
            time.sleep(1.6)
            n = cam("/rec/stop").get("frames", 0)
            cam("/torch/0")
            if n < 5:
                raise RuntimeError("%d frames at cp%d" % (n, k))
            patrol_st["state"] = "turn"
            t = time.time()
            while 0 <= sense[1] < stop_mm and time.time() - t < 1.5:
                cmd = ("lr", -SPIN, -SPIN)
                time.sleep(0.05)
            cmd = ("lr", 0, 0)
            spin(85)
        patrol_st["state"] = "done"
    except RuntimeError as e:
        patrol_st.update(state="failed", err=str(e))
    finally:
        cmd = None
        cam("/torch/0")

PAGE = """<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>RC Car</title><style>
*{box-sizing:border-box;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
body{margin:0;min-height:100dvh;background:#0d0f12;color:#e7e9ec;font-family:system-ui,sans-serif;
display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;touch-action:none;padding:16px}
h1{font-size:14px;font-weight:600;letter-spacing:.12em;color:#8b9099;margin:0;text-transform:uppercase;
display:flex;align-items:center;gap:8px}
#dot{width:9px;height:9px;border-radius:50%;background:#f85149;transition:.2s}
#dot.ok{background:#2ea043}
#joy{width:220px;height:220px;border-radius:50%;background:#1b1f26;position:relative;touch-action:none}
#knob{width:84px;height:84px;border-radius:50%;background:#2d333b;position:absolute;left:68px;top:68px;pointer-events:none}
#joy.on #knob{background:#1f6feb}
.sp{width:252px;display:flex;align-items:center;gap:12px;font-variant-numeric:tabular-nums;font-size:13px}
input[type=range]{flex:1;accent-color:#1f6feb}
.test{width:252px;border-top:1px solid #222;padding-top:12px}
.test summary{color:#8b9099;font-size:13px;cursor:pointer}
.tg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
.t{padding:12px;border:none;border-radius:10px;background:#1b1f26;color:#e7e9ec;font-size:13px}
.t:active{background:#9a6700}
small{color:#6b7280;font-size:12px}
#rec{padding:10px 18px;border:none;border-radius:999px;background:#1b1f26;color:#e7e9ec;font-size:13px;letter-spacing:.08em}
#rec.on{background:#da3633;color:#fff}
#au{padding:10px 18px;border:none;border-radius:999px;background:#1b1f26;color:#e7e9ec;font-size:13px;letter-spacing:.08em}
#au.on{background:#2ea043;color:#fff}
#cam{width:100%;max-width:520px;aspect-ratio:4/3;border-radius:14px;background:#000;object-fit:cover}
</style></head><body>
<h1><span id=dot></span>RC Car <span id=up></span></h1>
<video id=cam muted autoplay playsinline></video>
<button id=rec>&#9679; REC</button>
<button id=au>AUTO</button>
<div id=joy><div id=knob></div></div>
<div class=sp>SPD<input id=sp type=range min=60 max=255 value=220><span id=spv>220</span></div>
<details class=test><summary>Test each motor</summary>
<div class=tg>
<button class=t data-m=0>LF (D5)</button>
<button class=t data-m=2>RF (D9)</button>
<button class=t data-m=1>LR (D6)</button>
<button class=t data-m=3>RR (D10)</button>
</div><small>Tap one — that wheel should spin ~1.5s.</small></details>
<small id=st>ready · WASD to drive</small>
<script>
let spd=220,timer=null,jx=0,jy=0,ok=false;
const sp=sp0(),spv=byId('spv'),st=byId('st'),dot=byId('dot');
function byId(i){return document.getElementById(i)}
function sp0(){return byId('sp')}
sp.oninput=()=>{spd=+sp.value;spv.textContent=spd};
function mark(good){ok=good;dot.classList.toggle('ok',good)}
function hit(url){return fetch(url,{cache:'no-store'}).then(r=>{mark(true);return r}).catch(e=>{mark(false);throw e})}
function send(l,r){hit('/d?l='+l+'&r='+r).catch(()=>{})}
const joy=byId('joy'),knob=byId('knob'),R=110,K=42;
function drive(){const l=jy+jx,r=jy-jx,m=Math.max(1,Math.abs(l),Math.abs(r));
  send(Math.round(l/m*spd),Math.round(r/m*spd))}
function stop(){keys.clear();if(timer){clearInterval(timer);timer=null}jx=jy=0;knob.style.transform='';joy.classList.remove('on');send(0,0);st.textContent='stop'}
function move(e){const b=joy.getBoundingClientRect();let x=e.clientX-b.left-R,y=e.clientY-b.top-R;
  const d=Math.hypot(x,y),c=R-K;if(d>c){x*=c/d;y*=c/d}
  knob.style.transform=`translate(${x}px,${y}px)`;jx=x/c;jy=-y/c;
  if(Math.hypot(jx,jy)<0.15)jx=jy=0}
joy.addEventListener('pointerdown',e=>{e.preventDefault();joy.setPointerCapture(e.pointerId);joy.classList.add('on');move(e);
  drive();st.textContent='drive';if(!timer)timer=setInterval(drive,100)});
joy.addEventListener('pointermove',e=>{if(timer)move(e)});
['pointerup','pointercancel'].forEach(ev=>joy.addEventListener(ev,stop));
document.querySelectorAll('.t[data-m]').forEach(b=>b.addEventListener('click',()=>{
  hit('/t?m='+b.dataset.m+'&v='+spd).then(()=>st.textContent='test M'+b.dataset.m).catch(()=>{});
}));
addEventListener('blur',stop);
const keys=new Set();
function key(e){const k=e.key.toLowerCase();if(!/^[wasd]$/.test(k)||e.repeat)return;e.preventDefault();
  e.type=='keydown'?keys.add(k):keys.delete(k);
  if(!keys.size)return stop();
  jy=keys.has('w')-keys.has('s');jx=(keys.has('d')-keys.has('a'))*(jy?.5:1);
  drive();st.textContent='drive';if(!timer)timer=setInterval(drive,100)}
addEventListener('keydown',key);addEventListener('keyup',key);
byId('up').onclick=()=>hit('/cal').then(()=>st.textContent='heading zeroed').catch(()=>{});
const au=byId('au'),MODES=['drive','turn','check','stuck'];
au.onclick=()=>{const on=!au.classList.contains('on');hit('/a?on='+(on?1:0)).then(()=>{au.classList.toggle('on',on);st.textContent=on?'auto':'manual'}).catch(()=>{})};
const cm=v=>v<0?'--':(v/10).toFixed(0);
setInterval(()=>hit('/ping').then(r=>r.text()).then(t=>{const[u,f,h,a]=t.split(',').map(Number);au.classList.toggle('on',a>=0);if(a>=0)st.textContent='auto: '+(MODES[a]||a);byId('up').textContent='\u2191'+cm(u)+' \u2192'+cm(f)+(h>-99999?' '+((h/10%360+540)%360-180).toFixed(0)+'\u00b0':'')}).catch(()=>{}),500);
const CAM='http://'+location.hostname+':8081',rec=byId('rec');
const camj=u=>fetch(CAM+u,{cache:'no-store'}).then(r=>r.json());
camj('/rec').then(j=>rec.classList.toggle('on',!!j.rec)).catch(()=>{});
rec.onclick=()=>{const on=rec.classList.contains('on');
  camj(on?'/rec/stop':'/rec/start/'+new Date().toISOString().slice(0,19).replace(/[T:]/g,'-')).then(j=>{
    rec.classList.toggle('on',!on);st.textContent=on?'saved '+j.frames+' frames':'recording '+j.rec}).catch(()=>{st.textContent='cam offline'})};
const cs=document.createElement('script');cs.src=CAM+'/jmuxer.js';cs.onload=cam;document.head.append(cs);
async function cam(){
  const v=byId('cam');
  setInterval(()=>{const b=v.buffered;if(b.length&&b.end(b.length-1)-v.currentTime>0.25)v.currentTime=b.end(b.length-1)-0.03},250);
  for(;;){
    const jm=new JMuxer({node:v,mode:'video',flushingTime:0,clearBuffer:true});
    try{
      const rd=(await fetch(CAM+'/v',{cache:'no-store'})).body.getReader();
      let buf=new Uint8Array(0),cfg=null,pts=null,dur=33;
      for(;;){
        const {value,done}=await rd.read();if(done)break;
        const b=new Uint8Array(buf.length+value.length);b.set(buf);b.set(value,buf.length);buf=b;
        while(buf.length>=12){
          const dv=new DataView(buf.buffer,buf.byteOffset),n=dv.getUint32(8);
          if(buf.length<12+n)break;
          const hi=dv.getUint32(0),p=(hi&0x1fffffff)*4294967296+dv.getUint32(4),d=buf.slice(12,12+n);
          buf=buf.slice(12+n);
          if(hi&0x40000000){cfg=d;continue}
          if(pts!==null&&p>pts)dur=(p-pts)/1000;pts=p;
          const c=cfg||[],f=new Uint8Array(c.length+d.length+4);f.set(c);f.set(d,c.length);f[f.length-1]=1;cfg=null;
          jm.feed({video:f,duration:dur});
        }
      }
    }catch(e){}
    jm.destroy();await new Promise(r=>setTimeout(r,2000));
  }
}
</script></body></html>"""
PAGE_B = PAGE.encode()


def clamp(x):
    try:
        return max(-255, min(255, int(float(x))))
    except (ValueError, TypeError):
        return 0


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _nc(self, code):
        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        global hits
        hits += 1
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(PAGE_B)))
            self.end_headers()
            self.wfile.write(PAGE_B)
        elif u.path == "/d":
            with lock:
                if q.get("l", ["0"])[0] != "0" or q.get("r", ["0"])[0] != "0":
                    auto["on"] = False
                    if patrol_st["state"] in RUNNING:
                        patrol_st["state"] = "abort"
                state.update(l=clamp(q.get("l", ["0"])[0]), r=clamp(q.get("r", ["0"])[0]), ts=time.time())
            self._nc(204)
        elif u.path == "/t":
            with lock:
                test.update(m=clamp(q.get("m", ["-1"])[0]), v=clamp(q.get("v", ["200"])[0]), until=time.time() + 1.5)
            self._nc(204)
        elif u.path == "/a":
            with lock:
                auto.update(on=q.get("on", ["0"])[0] == "1", seen=time.time())
            self._nc(204)
        elif u.path == "/patrol":
            if "abort" in q and patrol_st["state"] in RUNNING:
                patrol_st["state"] = "abort"
            elif "legs" in q and patrol_st["state"] not in RUNNING:
                patrol_st["state"] = "selfcheck"
                threading.Thread(target=patrol, args=(clamp(q["legs"][0]), clamp(q.get("stop", ["350"])[0])), daemon=True).start()
            b = json.dumps(patrol_st).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
        elif u.path == "/cal":
            global want_cal
            want_cal = True
            self._nc(204)
        elif u.path == "/ping":
            auto["seen"] = time.time()
            b = ("%d,%d,%d,%d" % sense).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
        else:
            self._nc(404)


threading.Thread(
    target=lambda: ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever(),
    daemon=True,
).start()

log_t = 0.0


def call(name, dflt):
    try:
        return Bridge.call(name, timeout=1)
    except Exception:
        return dflt


def loop():
    global log_t, sense, want_cal
    if want_cal:
        want_cal = False
        call("cal", 0)
    now = time.time()
    sense = (call("dist", -1), call("front", -1), call("hdg", -99999), call("mode", -1))
    with lock:
        if auto["on"] and now - auto["seen"] > 1.5:
            auto["on"] = False
        au = auto["on"]
        l, r, ts = state["l"], state["r"], state["ts"]
        tm, tv, tu = test["m"], test["v"], test["until"]
    c = cmd
    Bridge.notify("auto", int(au and not c))
    if c and c[0] == "hold":
        Bridge.notify("hold", c[1])
    elif c:
        Bridge.notify("left", c[1])
        Bridge.notify("right", c[2])
    elif au:
        pass
    elif 0 <= tm <= 3 and now < tu:
        for i in range(4):
            Bridge.notify("m%d" % i, tv if i == tm else 0)
    else:
        if now - ts > STALE:
            l = r = 0
        Bridge.notify("left", l)
        Bridge.notify("right", r)
    if now - log_t > 5:
        log_t = now
        print("[rccar] hits=%d l=%d r=%d sense=%s patrol=%s" % (hits, l, r, sense, patrol_st), flush=True)
    time.sleep(0.05)


App.run(user_loop=loop)
