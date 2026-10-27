// Voice SOS detection on synthetic audio: loudness scale, voicing, noise rejection,
// sustained cries, plus the shake and fall detectors. Run from app/: node scripts/test-voice.cjs
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function load(rel) {
  const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, (m) => {
    if (m === 'react-native') return { Platform: { OS: 'android' } };
    if (m === 'expo-sensors') return {};
    throw new Error('unexpected import ' + m);
  });
  return mod.exports;
}

const V = load('src/ml/VoiceAnalyzer.ts');
const { ShakeDetector } = load('src/services/motionHub.ts');
const { FallDetector } = load('src/ml/FallDetector.ts');

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};

const SR = 16000;
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
/** amplitude for a level on the app's dB scale (RMS) */
// tone(): 0.7/0.2/0.1 harmonics have RMS a*sqrt((0.49+0.04+0.01)/2); noise(): uniform, RMS a/sqrt(3)
const ampFor = (db, sine) => Math.pow(10, (db - V.DB_OFFSET) / 20) * (sine ? 1 / Math.sqrt(0.54 / 2) : Math.sqrt(3));
function tone(ms, db, f0) {
  const n = Math.round((SR * ms) / 1000), out = new Float32Array(n), a = ampFor(db, true);
  // a voice: fundamental + harmonics with a slight 5 Hz vibrato (phase accumulated)
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = f0 * (1 + 0.01 * Math.sin(2 * Math.PI * 5 * t));
    ph += (2 * Math.PI * f) / SR;
    out[i] = a * (0.7 * Math.sin(ph) + 0.2 * Math.sin(2 * ph) + 0.1 * Math.sin(3 * ph));
  }
  return out;
}
function noise(ms, db) {
  const n = Math.round((SR * ms) / 1000), out = new Float32Array(n), a = ampFor(db, false);
  for (let i = 0; i < n; i++) out[i] = a * rand();
  return out;
}
const mix = (a, b) => a.map((v, i) => v + (b[i] || 0));

// 1. frame measurements
{
  const f = V.analyseFrame(tone(32, 70, 400).subarray(0, 512));
  check('voice frame: level ~70 dB', Math.abs(f.db - 70) < 2.5, `db=${f.db.toFixed(1)}`);
  check('voice frame: periodic', f.voicing > 0.8, `voicing=${f.voicing.toFixed(2)}`);
  check('voice frame: pitch ~400 Hz', Math.abs(f.f0 - 400) < 25, `f0=${f.f0.toFixed(0)}`);
  const n = V.analyseFrame(noise(32, 70).subarray(0, 512));
  check('noise frame: not periodic', n.voicing < 0.45, `voicing=${n.voicing.toFixed(2)}`);
}

// helper: run an audio track through analyzer + cry detector in 250 ms hops
function run(track, triggerDb, warmup) {
  const an = new V.VoiceAnalyzer();
  const cry = new V.CryDetector();
  const HOP = 4000;
  let t = 0, triggered = false, maxSustained = 0, last;
  const all = warmup ? Float32Array.from([...warmup, ...track]) : track;
  for (let i = 0; i + HOP <= all.length; i += HOP) {
    t += 250;
    const hop = an.process(all.subarray(i, i + HOP));
    const st = cry.push(cry.isCry(hop, triggerDb), t, 250);
    maxSustained = Math.max(maxSustained, st.sustainedMs);
    triggered = triggered || st.triggered;
    last = hop;
  }
  return { triggered, maxSustained, last };
}
const quietRoom = noise(5000, 38);
const TRIGGER = 69; // 60 dB normal speech + 15 %

// 2. sustained scream triggers, other sounds do not
check('3 s scream at 85 dB, 600 Hz -> SOS', run(mix(tone(3200, 85, 600), noise(3200, 38)), TRIGGER, quietRoom).triggered);
check('1.5 s scream -> no SOS (too short)', !run(mix(tone(1500, 85, 600), noise(1500, 38)), TRIGGER, quietRoom).triggered);
check('normal speech level 60 dB for 4 s -> no SOS', !run(mix(tone(4000, 60, 300), noise(4000, 38)), TRIGGER, quietRoom).triggered);
check('loud LOW-pitched hum 85 dB, 120 Hz -> no SOS', !run(tone(4000, 85, 120), TRIGGER, quietRoom).triggered);
check('loud broadband noise 85 dB (traffic, crowd) -> no SOS', !run(noise(4000, 85), TRIGGER, quietRoom).triggered);
{
  // speech-like: 200 ms voiced syllables with 150 ms gaps, loud
  const parts = [];
  for (let k = 0; k < 12; k++) { parts.push(...tone(200, 78, 320)); parts.push(...noise(150, 38)); }
  check('loud talking with pauses (syllables) -> no SOS', !run(Float32Array.from(parts), TRIGGER, quietRoom).triggered);
}
{
  // noisy hall: 72 dB of crowd noise; a scream must stand out by 10 dB
  const hall = noise(6000, 72);
  check('noisy hall (72 dB noise) alone -> no SOS', !run(noise(4000, 72), TRIGGER, hall).triggered);
  check('scream over the noisy hall (88 dB) -> SOS', run(mix(tone(3200, 88, 650), noise(3200, 72)), TRIGGER, hall).triggered);
}
{
  const an = new V.VoiceAnalyzer();
  for (let i = 0; i < quietRoom.length; i += 4000) an.process(quietRoom.subarray(i, i + 4000));
  check('noise floor tracks a quiet room (~38 dB)', Math.abs(an.noiseFloorDb - 38) < 4, `floor=${an.noiseFloorDb.toFixed(1)}`);
  check('digital silence is flagged (microphone taken by another app)', an.process(new Float32Array(4000)).silent);
}
check('recogniser volume maps onto the dB scale', V.recognizerRmsToDb(-2) < 40 && V.recognizerRmsToDb(10) > 75);

// 3. shake
{
  const sd = new ShakeDetector();
  let fired = false;
  // vigorous shake: 2.6 g peaks every 125 ms (4 Hz back and forth) for 1.5 s, sampled at 50 Hz
  for (let i = 0; i < 75; i++) {
    const t = 1000 + i * 20, phase = (i % 6) / 6;
    const g = phase < 0.17 ? 2.6 : 1.0;
    fired = sd.push({ ax: 0, ay: g, az: 0, t }) || fired;
  }
  check('vigorous shake for 1.5 s -> SOS', fired);
  const run2 = new ShakeDetector();
  let falseFire = false;
  // running: 2.3 g foot strikes ~2.8 per second for 10 s
  for (let i = 0; i < 500; i++) {
    const t = 1000 + i * 20, g = i % 18 === 0 ? 2.3 : 1.0;
    falseFire = run2.push({ ax: 0, ay: 0, az: g, t }) || falseFire;
  }
  check('running (2.8 strikes/s) -> no SOS', !falseFire);
}

// 4. fall: free fall + impact + lying still, with a model that never fires
(async () => {
  const G = 9.80665;
  const det = new FallDetector(() => 0, { threshold: 0.98 });
  let confirmed = false;
  let t = 0;
  const push = async (g, n) => { for (let i = 0; i < n; i++) { t += 20; const st = await det.push({ ax: 0, ay: 0, az: g * G, gx: 0, gy: 0, gz: 0 }, t); confirmed = confirmed || st.fallConfirmed; } };
  await push(1.0, 150); // standing
  await push(0.1, 15); // 300 ms free fall
  await push(3.0, 3); // impact
  await push(1.4, 10); // bounce
  await push(1.0, 200); // lying still 4 s
  check('drop (free fall + impact + still) -> fall SOS even when the model scores 0', confirmed, `by=${det.lastImpactBy}`);

  const det2 = new FallDetector(() => 0, { threshold: 0.98 });
  let c2 = false; t = 0;
  const push2 = async (g, n, wobble) => { for (let i = 0; i < n; i++) { t += 20; const st = await det2.push({ ax: wobble ? Math.sin(i) * 0.6 * G : 0, ay: 0, az: g * G, gx: wobble ? 2 : 0, gy: 0, gz: 0 }, t); c2 = c2 || st.fallConfirmed; } };
  await push2(1.0, 100, false);
  await push2(0.1, 15, false); // jump: airborne
  await push2(3.0, 3, false); // landing
  await push2(1.0, 600, true); // walks on (moving)
  check('jump then walking on -> no fall SOS', !c2);

  console.log(failed ? `\n${failed} check(s) failed` : '\nall voice/motion checks passed');
  process.exit(failed ? 1 : 0);
})();
