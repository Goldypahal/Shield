import { Platform } from 'react-native';
import { Accelerometer, Gyroscope } from 'expo-sensors';

/**
 * One shared 50 Hz motion stream for every feature that needs the motion sensors (fall
 * detection, shake to SOS, the threat monitor).
 *
 * Why: expo-sensors has ONE update interval per sensor for the whole app. Before, fall
 * detection asked for 20 ms and shake detection for 250 ms; whichever started last won,
 * so with shake turned on the fall model was fed 4 samples a second instead of 50 and
 * never fired. Now the sensors always run at 50 Hz while anyone listens.
 */
export interface MotionSample {
  /** Acceleration in g, gravity included (lying flat: z is about 1). */
  ax: number;
  ay: number;
  az: number;
  /** Rotation rate in rad/s (0 when the phone has no gyroscope). */
  gx: number;
  gy: number;
  gz: number;
  /** Time of the sample (ms). */
  t: number;
}

export const MOTION_HZ = 50;
const INTERVAL_MS = Math.round(1000 / MOTION_HZ);

type Listener = (s: MotionSample) => void;
const listeners = new Set<Listener>();
let accSub: { remove: () => void } | null = null;
let gyroSub: { remove: () => void } | null = null;
let starting: Promise<void> | null = null;
const gyro = { x: 0, y: 0, z: 0 };
let available: boolean | null = null;

async function start() {
  if (Platform.OS === 'web') return;
  const [accOk, gyroOk] = await Promise.all([
    Accelerometer.isAvailableAsync().catch(() => false),
    Gyroscope.isAvailableAsync().catch(() => false),
  ]);
  available = accOk;
  if (!accOk || listeners.size === 0 || accSub) return;
  if (gyroOk) {
    Gyroscope.setUpdateInterval(INTERVAL_MS);
    gyroSub = Gyroscope.addListener((g) => { gyro.x = g.x; gyro.y = g.y; gyro.z = g.z; });
  }
  Accelerometer.setUpdateInterval(INTERVAL_MS);
  accSub = Accelerometer.addListener(({ x, y, z }) => {
    const s: MotionSample = { ax: x, ay: y, az: z, gx: gyro.x, gy: gyro.y, gz: gyro.z, t: Date.now() };
    listeners.forEach((l) => {
      try { l(s); } catch (e) { console.warn('[motionHub] listener failed', e); }
    });
  });
}

function stop() {
  accSub?.remove();
  gyroSub?.remove();
  accSub = null;
  gyroSub = null;
}

/** Subscribes to the shared 50 Hz stream; returns the unsubscribe function. */
export function subscribeMotion(listener: Listener): () => void {
  listeners.add(listener);
  if (!accSub) {
    starting = (starting ?? Promise.resolve()).then(start).catch((e) => console.warn('[motionHub] start failed', e));
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/** Whether the phone has an accelerometer (null until the first subscription checked). */
export function motionAvailable(): boolean | null {
  return available;
}

/**
 * Shake gesture from the shared stream: a "jolt" is a sample at least `joltG` away from
 * 1 g (gravity); jolts closer than `minGapMs` are one movement. `jolts` jolts within
 * `windowMs` is a deliberate shake. Pure logic, unit tested in scripts/test-motion.cjs.
 */
export class ShakeDetector {
  private times: number[] = [];
  private cooldownUntil = 0;
  constructor(
    // Shaking back and forth peaks twice per cycle (at both ends), 4-8 times a second.
    // Running also reaches 2 g, but only ~3 times a second, so it never gets 6 in 1.6 s.
    private readonly opts = { joltG: 1.0, minGapMs: 120, jolts: 6, windowMs: 1600, cooldownMs: 5000 },
  ) {}

  push(s: Pick<MotionSample, 'ax' | 'ay' | 'az' | 't'>): boolean {
    if (s.t < this.cooldownUntil) return false;
    const mag = Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az);
    if (Math.abs(mag - 1) < this.opts.joltG) return false;
    const last = this.times[this.times.length - 1];
    if (last !== undefined && s.t - last < this.opts.minGapMs) return false;
    this.times.push(s.t);
    this.times = this.times.filter((t) => s.t - t <= this.opts.windowMs);
    if (this.times.length >= this.opts.jolts) {
      this.times = [];
      this.cooldownUntil = s.t + this.opts.cooldownMs;
      return true;
    }
    return false;
  }
}
