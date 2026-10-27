/**
 * Turns a 50 Hz motion stream into "a fall happened" decisions.
 *
 * Step 1, impact: the fall model (fall_detection.tflite, trained by
 * backend/ml/motion/train_fall.py on MobiFall + SisFall) scores the latest 2 s every 0.5 s.
 * Tested on 12 people it never saw it caught 218 of 222 falls, but on hard daily activity
 * (jogging, jumping, stairs, flopping into a chair) it also fired about 4.6 times an hour.
 *
 * Step 2, confirmation: a real fall ends with the person on the ground, so after a model
 * hit the phone has to lie (nearly) still for STILL_MS within CONFIRM_WINDOW_MS. A jump or
 * sitting down is followed by normal movement and is dropped. Only then does the SOS
 * countdown start (where a false alarm is still cancelled with the PIN).
 *
 * Pure logic, no React Native imports, so it can be unit tested.
 */

export const FALL_FS = 50;
export const FALL_WINDOW = 100; // 2 s, model input [1, 100, 6]
export const FALL_CHANNELS = 6; // ax, ay, az (m/s^2), gx, gy, gz (rad/s)
const G = 9.80665;

export interface FallDetectorOptions {
  /** Model score that counts as an impact (train_fall.py picks it on held-out people). */
  threshold: number;
  /** Run the model every this many samples (25 = 0.5 s). */
  hopSamples: number;
  /** How long the phone must stay still after the impact. */
  stillMs: number;
  /** Stillness must be reached within this time after the impact, else it was not a fall. */
  confirmWindowMs: number;
  /** "Still": |acc| within this many g of 1 g ... */
  stillAccToleranceG: number;
  /** ... and rotation below this (rad/s). */
  stillGyroMax: number;
  /** No new fall for this long after one was reported. */
  cooldownMs: number;
  /**
   * Physics path, next to the model: free fall (|acc| below `freefallG` for `freefallMs`)
   * followed within `impactWithinMs` by an impact of at least `impactG`. This is what a
   * dropped phone or a person falling with the phone in hand does even when the model,
   * trained on phones in a trouser pocket, scores the movement lower. Set impactG to 0 to
   * turn it off. Stillness afterwards is still required, as for the model.
   */
  freefallG: number;
  freefallMs: number;
  impactG: number;
  impactWithinMs: number;
}

export const DEFAULT_FALL_OPTIONS: FallDetectorOptions = {
  threshold: 0.98,
  hopSamples: 25,
  stillMs: 3000,
  confirmWindowMs: 10000,
  stillAccToleranceG: 0.3,
  stillGyroMax: 1.0,
  cooldownMs: 30000,
  freefallG: 0.5,
  freefallMs: 80,
  impactG: 1.8,
  impactWithinMs: 1000,
};

export type FallPhase = 'watching' | 'impact' | 'cooldown';

export interface FallStatus {
  phase: FallPhase;
  /** Latest model score (0..1), -1 before the first window. */
  score: number;
  /** True exactly once per confirmed fall. */
  fallConfirmed: boolean;
}

export type FallPredictor = (window: Float32Array) => number | Promise<number>;

export class FallDetector {
  private readonly opts: FallDetectorOptions;
  private readonly buf = new Float32Array(FALL_WINDOW * FALL_CHANNELS);
  private filled = 0;
  private sinceHop = 0;
  private busy = false;
  private phase: FallPhase = 'watching';
  private impactAt = 0;
  private stillSince: number | null = null;
  private cooldownUntil = 0;
  private score = -1;
  private freefallSince: number | null = null;
  private freefallEnded = 0;
  /** What raised the last impact: the model or the free-fall + impact physics. */
  public lastImpactBy: 'model' | 'physics' | null = null;

  constructor(private readonly predict: FallPredictor, opts: Partial<FallDetectorOptions> = {}) {
    this.opts = { ...DEFAULT_FALL_OPTIONS, ...opts };
  }

  reset() {
    this.filled = 0;
    this.sinceHop = 0;
    this.phase = 'watching';
    this.stillSince = null;
    this.score = -1;
  }

  /** Adds one sample (m/s^2 and rad/s) taken at `t` ms. */
  async push(s: { ax: number; ay: number; az: number; gx: number; gy: number; gz: number }, t: number): Promise<FallStatus> {
    // slide the 2 s window
    this.buf.copyWithin(0, FALL_CHANNELS);
    this.buf.set([s.ax, s.ay, s.az, s.gx, s.gy, s.gz], (FALL_WINDOW - 1) * FALL_CHANNELS);
    this.filled = Math.min(FALL_WINDOW, this.filled + 1);
    this.sinceHop += 1;

    if (this.phase === 'cooldown') {
      if (t < this.cooldownUntil) return this.status(false);
      this.phase = 'watching';
    }

    if (this.phase === 'impact') {
      const accG = Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az) / G;
      const gyro = Math.sqrt(s.gx * s.gx + s.gy * s.gy + s.gz * s.gz);
      const still = Math.abs(accG - 1) <= this.opts.stillAccToleranceG && gyro <= this.opts.stillGyroMax;
      if (!still) {
        this.stillSince = null;
      } else if (this.stillSince === null) {
        this.stillSince = t;
      }
      if (this.stillSince !== null && t - this.stillSince >= this.opts.stillMs) {
        this.phase = 'cooldown';
        this.cooldownUntil = t + this.opts.cooldownMs;
        this.stillSince = null;
        return this.status(true);
      }
      if (t - this.impactAt > this.opts.confirmWindowMs) {
        this.phase = 'watching'; // got up / kept moving: a jump or a sit-down, not a fall
        this.stillSince = null;
      }
      return this.status(false);
    }

    // watching, physics path: free fall then a hard landing
    if (this.opts.impactG > 0) {
      const accG = Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az) / G;
      if (accG < this.opts.freefallG) {
        if (this.freefallSince === null) this.freefallSince = t;
      } else {
        if (this.freefallSince !== null && t - this.freefallSince >= this.opts.freefallMs) this.freefallEnded = t;
        this.freefallSince = null;
        if (accG >= this.opts.impactG && this.freefallEnded && t - this.freefallEnded <= this.opts.impactWithinMs) {
          this.freefallEnded = 0;
          this.phase = 'impact';
          this.impactAt = t;
          this.stillSince = null;
          this.lastImpactBy = 'physics';
          return this.status(false);
        }
      }
    }

    // watching: score the latest 2 s every hop
    if (this.filled < FALL_WINDOW || this.sinceHop < this.opts.hopSamples || this.busy) return this.status(false);
    this.sinceHop = 0;
    this.busy = true;
    try {
      this.score = await this.predict(this.buf.slice());
    } finally {
      this.busy = false;
    }
    if (this.score >= this.opts.threshold && this.phase === 'watching') {
      this.lastImpactBy = 'model';
      this.phase = 'impact';
      this.impactAt = t;
      this.stillSince = null;
    }
    return this.status(false);
  }

  private status(fallConfirmed: boolean): FallStatus {
    return { phase: this.phase, score: this.score, fallConfirmed };
  }
}
