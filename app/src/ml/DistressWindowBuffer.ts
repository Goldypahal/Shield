/**
 * SRS DET-1 & DET-3: Temporal Smoothing 3-of-5 Window Trigger Buffer.
 * 
 * - Windows: 0.975-second non-overlapping or hop audio windows.
 * - Criterion: Triggers pre-alert when distress probability >= 0.80 
 *   in 3 of 5 consecutive windows.
 * - Prevents transient environmental noise spikes (e.g. horn, door slam) 
 *   from triggering false emergencies.
 */

export interface WindowResult {
  windowIndex: number;
  timestamp: number;
  probability: number;
  isDistressWindow: boolean;
}

export interface TemporalBufferStatus {
  windowCount: number;
  distressWindowCount: number;
  thresholdMet: boolean;
  history: number[];
  latestProbability: number;
}

export class DistressWindowBuffer {
  private readonly bufferSize: number = 5;
  private readonly distressThreshold: number = 0.80;
  private readonly triggerRequiredCount: number = 3;

  private probabilities: number[] = [];
  private totalWindowsProcessed: number = 0;

  constructor(bufferSize: number = 5, distressThreshold: number = 0.80, triggerRequiredCount: number = 3) {
    this.bufferSize = bufferSize;
    this.distressThreshold = distressThreshold;
    this.triggerRequiredCount = triggerRequiredCount;
  }

  /**
   * Pushes a new 0.975-second inference window probability.
   * 
   * @param probability Model output in [0.0, 1.0]
   * @returns boolean true if 3 of last 5 windows >= 0.80
   */
  pushWindow(probability: number): TemporalBufferStatus {
    const clamped = Math.max(0.0, Math.min(1.0, probability));
    this.probabilities.push(clamped);
    this.totalWindowsProcessed += 1;

    // Maintain sliding window of size N (default 5)
    if (this.probabilities.length > this.bufferSize) {
      this.probabilities.shift();
    }

    const distressCount = this.probabilities.filter(p => p >= this.distressThreshold).length;
    const thresholdMet = distressCount >= this.triggerRequiredCount;

    return {
      windowCount: this.probabilities.length,
      distressWindowCount: distressCount,
      thresholdMet,
      history: [...this.probabilities],
      latestProbability: clamped
    };
  }

  /**
   * Resets the buffer (e.g., after alert cancellation or walk restart).
   */
  reset(): void {
    this.probabilities = [];
  }

  /**
   * Returns current buffer state without adding a new window.
   */
  getStatus(): TemporalBufferStatus {
    const distressCount = this.probabilities.filter(p => p >= this.distressThreshold).length;
    return {
      windowCount: this.probabilities.length,
      distressWindowCount: distressCount,
      thresholdMet: distressCount >= this.triggerRequiredCount,
      history: [...this.probabilities],
      latestProbability: this.probabilities[this.probabilities.length - 1] || 0.0
    };
  }
}

export default new DistressWindowBuffer();
