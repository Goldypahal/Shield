/**
 * Sustained-scream trigger: fires only when the scream model keeps hearing a scream
 * for about 3 seconds, so a single shout, a horn or a door slam never starts an SOS.
 *
 * Fed one model score per hop (every ~500 ms the latest 1 s of audio is classified).
 * Short dips below the threshold, such as a breath between screams, are bridged by
 * `maxGapMs`; a longer quiet stretch ends the run and the count starts again.
 */
export interface ScreamDetectorOptions {
  /** How long the scream must last before the SOS starts. */
  requiredMs: number;
  /** Model score at or above which a window counts as screaming. */
  threshold: number;
  /** Longest dip (e.g. a breath) that still counts as the same scream. */
  maxGapMs: number;
  /** After firing, ignore further screams for this long. */
  cooldownMs: number;
}

export interface ScreamDetectorStatus {
  /** Milliseconds of continuous screaming heard so far (0 when quiet). */
  sustainedMs: number;
  /** True exactly once, on the hop where the scream reached `requiredMs`. */
  triggered: boolean;
}

export const DEFAULT_SCREAM_OPTIONS: ScreamDetectorOptions = {
  requiredMs: 3000,
  threshold: 0.8,
  maxGapMs: 600,
  cooldownMs: 20000,
};

export class ScreamDurationDetector {
  private readonly opts: ScreamDetectorOptions;
  private runStart: number | null = null;
  private lastPositive = 0;
  private cooldownUntil = 0;

  constructor(options: Partial<ScreamDetectorOptions> = {}) {
    this.opts = { ...DEFAULT_SCREAM_OPTIONS, ...options };
  }

  /**
   * @param probability model score for the window ending at `nowMs`
   * @param nowMs       timestamp of the hop in milliseconds
   * @param hopMs       time since the previous hop (the new audio this window adds)
   * @param threshold   score that counts as a scream for the engine that produced it
   */
  push(probability: number, nowMs: number, hopMs: number, threshold = this.opts.threshold): ScreamDetectorStatus {
    if (nowMs < this.cooldownUntil) {
      this.runStart = null;
      return { sustainedMs: 0, triggered: false };
    }

    const screaming = probability >= threshold;

    if (screaming) {
      // Start a new run, or continue the current one if the gap was only a breath
      if (this.runStart === null || nowMs - this.lastPositive > this.opts.maxGapMs + hopMs) {
        this.runStart = nowMs - hopMs;
      }
      this.lastPositive = nowMs;
    } else if (this.runStart !== null && nowMs - this.lastPositive > this.opts.maxGapMs) {
      this.runStart = null;
    }

    if (this.runStart === null) return { sustainedMs: 0, triggered: false };

    const sustainedMs = this.lastPositive - this.runStart;
    if (sustainedMs >= this.opts.requiredMs) {
      this.runStart = null;
      this.cooldownUntil = nowMs + this.opts.cooldownMs;
      return { sustainedMs, triggered: true };
    }
    return { sustainedMs, triggered: false };
  }

  reset(): void {
    this.runStart = null;
    this.lastPositive = 0;
    this.cooldownUntil = 0;
  }
}
