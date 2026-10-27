/**
 * Loudness and "is this a human voice?" for the microphone stream, in plain TypeScript
 * (no React Native imports, so it is unit tested in scripts/test-voice.cjs).
 *
 * Per 32 ms frame of 16 kHz audio it measures:
 *   level     dB on an approximate sound-level scale: dBFS + DB_OFFSET (ordinary speech at
 *             arm's length ~ 60 dB, a shout ~ 75-85 dB, a quiet room ~ 30-40 dB). Phones
 *             differ, which is why the walker can calibrate their normal speaking level.
 *   voicing   how periodic the frame is (normalised autocorrelation peak, 0..1) and its
 *             pitch. Voices and screams are periodic; fans, traffic, rain, claps and
 *             crowd hiss are not, so noise is ignored however loud it is.
 * and keeps a background-noise floor (the 20th percentile of the last ~20 s), so a voice
 * only counts when it stands out from the room (a noisy hall raises the bar by itself).
 */

export const SAMPLE_RATE = 16000;
export const FRAME = 512; // 32 ms
export const DB_OFFSET = 100;
const MIN_F0 = 120;
const MAX_F0 = 1200;
const FLOOR_WINDOW_FRAMES = Math.round(20000 / 32); // ~20 s

export interface FrameInfo {
  db: number;
  voicing: number;
  f0: number;
}

export interface HopResult {
  /** Loudest frame in this hop (dB) - what the meter shows. */
  peakDb: number;
  /** Median frame level (dB) - steady loudness, used for sustained cries. */
  medianDb: number;
  /** Background noise floor (dB). */
  floorDb: number;
  /** Share of frames that are voiced AND stand out from the floor. */
  voicedRatio: number;
  /** Median pitch of those voiced frames (Hz), 0 when none. */
  f0: number;
  /** True when the input is digital silence (another app or service holds the microphone). */
  silent: boolean;
  frames: FrameInfo[];
}

export function dbOf(rms: number, offset = DB_OFFSET): number {
  const dbfs = 20 * Math.log10(Math.max(rms, 1e-7));
  return Math.max(0, Math.min(120, dbfs + offset));
}

/** Level, voicing strength and pitch of one frame. */
export function analyseFrame(x: Float32Array, offset = DB_OFFSET): FrameInfo {
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  let e0 = 0;
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    y[i] = x[i] - mean;
    e0 += y[i] * y[i];
  }
  const rms = Math.sqrt(e0 / n);
  const db = dbOf(rms, offset);
  if (e0 < 1e-9) return { db, voicing: 0, f0: 0 };

  const minLag = Math.floor(SAMPLE_RATE / MAX_F0);
  const maxLag = Math.min(n - 32, Math.ceil(SAMPLE_RATE / MIN_F0));
  const rs = new Float32Array(maxLag + 1);
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let ea = 0;
    let eb = 0;
    for (let i = 0; i + lag < n; i++) {
      const a = y[i];
      const b = y[i + lag];
      num += a * b;
      ea += a * a;
      eb += b * b;
    }
    const r = num / Math.sqrt(ea * eb + 1e-12);
    rs[lag] = r;
    if (r > best) best = r;
  }
  // The true period is the first lag close to the best one (2x, 3x the period score
  // nearly as high and would halve the pitch)
  let bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (rs[lag] >= 0.9 * best && (lag === maxLag || rs[lag] >= rs[lag + 1])) { bestLag = lag; break; }
  }
  return { db, voicing: Math.max(0, best), f0: bestLag ? SAMPLE_RATE / bestLag : 0 };
}

function median(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export interface VoiceAnalyzerOptions {
  /** dBFS -> dB scale offset. */
  offset: number;
  /** A frame counts as voiced at or above this periodicity. */
  voicingMin: number;
  /** ... and when it is at least this far above the noise floor (dB). */
  aboveFloorDb: number;
}

export const DEFAULT_ANALYZER: VoiceAnalyzerOptions = { offset: DB_OFFSET, voicingMin: 0.45, aboveFloorDb: 8 };

export class VoiceAnalyzer {
  private readonly opts: VoiceAnalyzerOptions;
  private history: number[] = [];
  private carry = new Float32Array(0);
  private floor = 35;

  constructor(opts: Partial<VoiceAnalyzerOptions> = {}) {
    this.opts = { ...DEFAULT_ANALYZER, ...opts };
  }

  get noiseFloorDb() {
    return this.floor;
  }

  /** Analyses a new chunk of 16 kHz mono audio in [-1, 1]. */
  process(chunk: Float32Array): HopResult {
    // join with the leftover of the previous chunk so frames are always FRAME long
    const data = new Float32Array(this.carry.length + chunk.length);
    data.set(this.carry);
    data.set(chunk, this.carry.length);
    const nFrames = Math.floor(data.length / FRAME);
    this.carry = data.slice(nFrames * FRAME);

    let peakAbs = 0;
    for (let i = 0; i < chunk.length; i++) peakAbs = Math.max(peakAbs, Math.abs(chunk[i]));

    const frames: FrameInfo[] = [];
    for (let f = 0; f < nFrames; f++) frames.push(analyseFrame(data.subarray(f * FRAME, (f + 1) * FRAME), this.opts.offset));

    for (const fr of frames) this.history.push(fr.db);
    if (this.history.length > FLOOR_WINDOW_FRAMES) this.history.splice(0, this.history.length - FLOOR_WINDOW_FRAMES);
    if (this.history.length >= 8 && frames.length) {
      const s = [...this.history].sort((a, b) => a - b);
      const target = s[Math.floor(s.length * 0.2)];
      // Falls at once, rises slowly (1.5 dB/s): a room getting noisier raises the bar
      // within seconds, but a scream lasting a few seconds is never taken for the room.
      const hopS = (frames.length * FRAME) / SAMPLE_RATE;
      this.floor = target < this.floor ? target : Math.min(target, this.floor + 1.5 * hopS);
    }

    const voiced = frames.filter((f) => f.voicing >= this.opts.voicingMin && f.db >= this.floor + this.opts.aboveFloorDb);
    return {
      peakDb: frames.length ? Math.max(...frames.map((f) => f.db)) : 0,
      medianDb: median(frames.map((f) => f.db)),
      floorDb: this.floor,
      voicedRatio: frames.length ? voiced.length / frames.length : 0,
      f0: median(voiced.map((f) => f.f0)),
      silent: peakAbs < 1e-4,
      frames,
    };
  }

  reset() {
    this.history = [];
    this.carry = new Float32Array(0);
    this.floor = 35;
  }
}

export interface CryOptions {
  /** How long the cry must last before the SOS starts. */
  requiredMs: number;
  /** Longest dip (a breath) that still counts as the same cry. */
  maxGapMs: number;
  cooldownMs: number;
  /** A cry is continuous voicing (speech has gaps between syllables and words). */
  minVoicedRatio: number;
  /** ... and high: screams sit well above normal speaking pitch. */
  minF0: number;
  /** ... and stands out from the room. */
  aboveFloorDb: number;
}

export const DEFAULT_CRY: CryOptions = {
  requiredMs: 2500, maxGapMs: 600, cooldownMs: 20000, minVoicedRatio: 0.7, minF0: 250, aboveFloorDb: 10,
};

export interface CryStatus {
  /** This hop counts as screaming / crying out. */
  crying: boolean;
  sustainedMs: number;
  triggered: boolean;
}

/**
 * Sustained scream or shout: loud (at or above the walker's trigger level), clearly above
 * the room's noise, continuously voiced and high-pitched, for `requiredMs` (dips of
 * `maxGapMs` allowed). A scream-model score at or above `modelThreshold` may stand in for
 * the voicing test (the model hears screams that are too rough to be periodic), but the
 * loudness tests always apply.
 */
export class CryDetector {
  private readonly opts: CryOptions;
  private runStart: number | null = null;
  private lastPositive = 0;
  private cooldownUntil = 0;

  constructor(opts: Partial<CryOptions> = {}) {
    this.opts = { ...DEFAULT_CRY, ...opts };
  }

  isCry(hop: Pick<HopResult, 'medianDb' | 'floorDb' | 'voicedRatio' | 'f0'>, triggerDb: number, modelProb = 0, modelThreshold = 1.1): boolean {
    const loud = hop.medianDb >= triggerDb && hop.medianDb >= hop.floorDb + this.opts.aboveFloorDb;
    if (!loud) return false;
    const voiceLike = hop.voicedRatio >= this.opts.minVoicedRatio && hop.f0 >= this.opts.minF0;
    return voiceLike || modelProb >= modelThreshold;
  }

  push(crying: boolean, nowMs: number, hopMs: number): CryStatus {
    if (nowMs < this.cooldownUntil) {
      this.runStart = null;
      return { crying, sustainedMs: 0, triggered: false };
    }
    if (crying) {
      if (this.runStart === null || nowMs - this.lastPositive > this.opts.maxGapMs + hopMs) this.runStart = nowMs - hopMs;
      this.lastPositive = nowMs;
    } else if (this.runStart !== null && nowMs - this.lastPositive > this.opts.maxGapMs) {
      this.runStart = null;
    }
    if (this.runStart === null) return { crying, sustainedMs: 0, triggered: false };
    const sustainedMs = this.lastPositive - this.runStart;
    if (sustainedMs >= this.opts.requiredMs) {
      this.runStart = null;
      this.cooldownUntil = nowMs + this.opts.cooldownMs;
      return { crying, sustainedMs, triggered: true };
    }
    return { crying, sustainedMs, triggered: false };
  }

  reset() {
    this.runStart = null;
    this.lastPositive = 0;
    this.cooldownUntil = 0;
  }
}

/**
 * Android's speech recogniser reports input volume as rmsdB, roughly -2 (silence) to 10
 * (shouting). Mapped onto the same dB scale so the meter and trigger level stay one
 * scale when only the recogniser has the microphone.
 */
export function recognizerRmsToDb(rms: number): number {
  return Math.max(20, Math.min(100, 45 + rms * 3.5));
}
