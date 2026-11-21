#include <Arduino_RouterBridge.h>
#include <Wire.h>

struct Motor { int en, in1, in2, invert; };
struct Echo { int pin; volatile unsigned long start, us, at; };

Motor motors[4] = {
  {5, 7, 8, 0},
  {6, 2, 4, 0},
  {9, 12, 13, 0},
  {10, A1, A2, 0},
};
Echo echoes[2] = {{A3, 0, 0, 0}, {3, 0, 0, 0}};

const int TRIG = 11, IMU_ADDR = 0x68;
const int CRUISE = 180, SPIN = 150, CLEAR = 350, STOP_MM = 150;
const float KP = 4, KI = 0.6, KD = 0.5;
const unsigned long TIMEOUT_MS = 300, PERIOD_US = 10000, PING_MS = 60, IMU_US = 10000;
int val[4] = {0, 0, 0, 0};
unsigned long last[4] = {0, 0, 0, 0}, lastPing = 0, lastImu = 0, lastTry = 0;
float ux, uy, uz, bx, by, bz, hdg = 0, r0 = 0, r1 = 0, rate = 0, iacc = 0, corr = 0;
bool imu = false;
int bad = 0;
int16_t pv[7];
volatile bool wantCal = false;
volatile unsigned long autoAt = 0;
bool was = false;
int st = 0, turns = 0, dir = 0;
float tgt = 0, t0 = 0;
unsigned long stAt = 0;

void drive(Motor &m, int v, unsigned long phase) {
  if (m.invert) v = -v;
  digitalWrite(m.in1, v > 0);
  digitalWrite(m.in2, v < 0);
  digitalWrite(m.en, phase < (unsigned long)abs(v) * PERIOD_US / 255);
}

void edge(Echo &e) {
  if (digitalRead(e.pin)) e.start = micros();
  else { e.us = micros() - e.start; e.at = millis(); }
}
void onUp() { edge(echoes[0]); }
void onFront() { edge(echoes[1]); }
int mm(Echo &e) { return millis() - e.at > 250 ? -1 : (int)(e.us * 343 / 2000); }

void wr(int reg, int v) {
  Wire.beginTransmission(IMU_ADDR);
  Wire.write(reg);
  Wire.write(v);
  Wire.endTransmission();
}

void unstick() {
  Wire.end();
  pinMode(SDA, INPUT_PULLUP);
  pinMode(SCL, OUTPUT);
  for (int i = 0; i < 9 && !digitalRead(SDA); i++) {
    digitalWrite(SCL, LOW);
    delayMicroseconds(5);
    digitalWrite(SCL, HIGH);
    delayMicroseconds(5);
  }
  Wire.begin();
  Wire.setClock(100000);
}

bool rd(int16_t *v) {
  Wire.beginTransmission(IMU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) || Wire.requestFrom(IMU_ADDR, 14) != 14) return false;
  for (int i = 0; i < 7; i++) {
    int h = Wire.read();
    v[i] = h << 8 | Wire.read();
  }
  return true;
}

void calibrate() {
  Wire.beginTransmission(IMU_ADDR);
  Wire.write(0x6B);
  Wire.write(0x80);
  if (Wire.endTransmission()) { unstick(); return; }
  delay(100);
  wr(0x6B, 1);
  wr(0x1A, 3);
  wr(0x1B, 0);
  delay(100);
  int16_t v[7];
  float s[6] = {0, 0, 0, 0, 0, 0};
  const int N = 200;
  for (int n = 0; n < N; n++) {
    if (!rd(v)) return;
    for (int i = 0; i < 3; i++) { s[i] += v[i]; s[i + 3] += v[i + 4]; }
    delay(5);
  }
  float g = sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]);
  if (g < 12000.0f * N || g > 21000.0f * N) return;
  ux = s[0] / g; uy = s[1] / g; uz = s[2] / g;
  bx = s[3] / N; by = s[4] / N; bz = s[5] / N;
  hdg = 0;
  bad = 0;
  imu = true;
  lastImu = micros();
}

void set(int i, int v) { val[i] = v; last[i] = millis(); }
void setLeft(int v)  { set(0, v); set(1, v); }
void setRight(int v) { set(2, v); set(3, v); }
void m0(int v) { set(0, v); }
void m1(int v) { set(1, v); }
void m2(int v) { set(2, v); }
void m3(int v) { set(3, v); }
int dist() { return mm(echoes[0]); }
int front() { return mm(echoes[1]); }
int recal() { wantCal = true; return 1; }
int heading() { return imu ? (int)(hdg * 10) : -99999; }
void autoRpc(int v) { autoAt = v ? millis() | 1 : 0; }
int mode() { return was ? st : -1; }

void pilot(unsigned long now) {
  bool blocked = mm(echoes[1]) < CLEAR;
  float d = hdg - t0;
  int l = 0, r = 0;
  if (!imu || st == 4) st = 4;
  else if (st == 0 && !blocked) {
    l = CRUISE - corr;
    r = CRUISE + corr;
  }
  else if (st == 0 || (st == 2 && now - stAt > 200 && blocked)) {
    if (++turns > 4) st = 4;
    else { st = 1; t0 = hdg; stAt = now; }
  }
  else if (st == 1 && fabsf(d) >= 85) { if (!dir) dir = d > 0 ? 1 : -1; st = 2; stAt = now; }
  else if (st == 1 && now - stAt > 3000) st = 4;
  else if (st == 1) { l = SPIN; r = -SPIN; }
  else if (st == 2 && now - stAt > 200) { st = 0; tgt = hdg; turns = 0; iacc = 0; }
  setLeft(l);
  setRight(r);
}

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(TRIG, OUTPUT);
  for (Echo &e : echoes) pinMode(e.pin, INPUT);
  attachInterrupt(digitalPinToInterrupt(echoes[0].pin), onUp, CHANGE);
  attachInterrupt(digitalPinToInterrupt(echoes[1].pin), onFront, CHANGE);
  for (int i = 0; i < 4; i++) {
    pinMode(motors[i].en, OUTPUT);
    pinMode(motors[i].in1, OUTPUT);
    pinMode(motors[i].in2, OUTPUT);
    drive(motors[i], 0, 0);
  }
  Bridge.begin();
  Bridge.provide("left", setLeft);
  Bridge.provide("right", setRight);
  Bridge.provide("m0", m0);
  Bridge.provide("m1", m1);
  Bridge.provide("m2", m2);
  Bridge.provide("m3", m3);
  Bridge.provide("dist", dist);
  Bridge.provide("front", front);
  Bridge.provide("hdg", heading);
  Bridge.provide("cal", recal);
  Bridge.provide("auto", autoRpc);
  Bridge.provide("mode", mode);
  Wire.begin();
  Wire.setClock(100000);
  calibrate();
}

void loop() {
  unsigned long now = millis(), us = micros(), phase = us % PERIOD_US;
  digitalWrite(LED_BUILTIN, (now / 250) % 2);
  if (now - lastPing >= PING_MS) {
    lastPing = now;
    digitalWrite(TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG, LOW);
  }
  if (wantCal || (!imu && now - lastTry > 2000)) { wantCal = imu = false; lastTry = now; calibrate(); }
  int16_t v[7];
  unsigned long t = micros();
  if (imu && t - lastImu >= IMU_US) {
    bool ok = rd(v) && memcmp(v, pv, sizeof v);
    memcpy(pv, v, sizeof v);
    if (!ok && ++bad > 20) imu = false;
    if (ok) {
      bad = 0;
      float r = ((v[4] - bx) * ux + (v[5] - by) * uy + (v[6] - bz) * uz) / 131.0f;
      float m = fmaxf(fminf(r, r0), fminf(fmaxf(r, r0), r1));
      r1 = r0;
      r0 = r;
      rate = m;
      if (!(val[0] | val[1] | val[2] | val[3]) && fabsf(m) < 2) {
        bx += (v[4] - bx) * 0.01f;
        by += (v[5] - by) * 0.01f;
        bz += (v[6] - bz) * 0.01f;
      } else hdg += m * (t - lastImu) / 1e6f;
      float e = dir * (hdg - tgt);
      iacc = constrain(iacc + e * IMU_US / 1e6f, -20, 20);
      corr = constrain(KP * e + KI * iacc + KD * dir * rate, -60, 60);
    }
    lastImu = t;
  }
  bool on = autoAt && (long)(millis() - autoAt) < 400;
  if (on && !was) { st = 0; turns = 0; tgt = hdg; iacc = 0; }
  was = on;
  if (on) pilot(now);
  for (int i = 0; i < 4; i++) if (now - last[i] > TIMEOUT_MS) val[i] = 0;
  int f = mm(echoes[1]), b = mm(echoes[0]), sum = val[0] + val[2];
  if ((sum > 0 && f >= 0 && f < STOP_MM) || (sum < 0 && b >= 0 && b < STOP_MM)) {
    int s = (val[0] - val[2]) / 2;
    val[0] = val[1] = s;
    val[2] = val[3] = -s;
  }
  for (int i = 0; i < 4; i++) drive(motors[i], val[i], phase);
  delay(1);
}
