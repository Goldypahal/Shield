/**
 * SRS DET-5: On-Device Fall and Struggle Motion Classifier.
 * 
 * Target Pipeline:
 * - 6-DOF Sensor Input: Accelerometer (ax, ay, az in m/s^2 or g) + Gyroscope (gx, gy, gz in rad/s).
 * - Sliding window: 100 timesteps at ~50 Hz (2.0 seconds).
 * - Fall Detection: High-G impact peak > 2.5g (~24.5 m/s^2) followed by >= 10 seconds stillness (|a - 1g| < 0.2g).
 * - Struggle Detection: Sustained erratic motion with severe jerk and high rotational energy.
 */

export interface MotionSample {
  ax: number; // m/s^2
  ay: number;
  az: number;
  gx: number; // rad/s
  gy: number;
  gz: number;
  timestamp: number;
}

export interface MotionClassificationResult {
  threatScore: number; // 0-100
  event: 'NORMAL' | 'FALL_SUSPECTED' | 'FALL_CONFIRMED' | 'STRUGGLE_DETECTED';
  peakImpactG: number;
  stillnessDurationSec: number;
  erraticIndex: number;
}

export class MotionClassifier {
  private static readonly G = 9.80665;
  private static readonly IMPACT_THRESHOLD_G = 2.5; // SRS DET-5: impact > 2.5g
  private static readonly STILLNESS_TOLERANCE_G = 0.25;
  private static readonly STILLNESS_REQUIRED_SEC = 10.0; // SRS DET-5: followed by 10s stillness

  private windowBuffer: MotionSample[] = [];
  private lastImpactTimestamp: number | null = null;
  private peakImpactRecordedG: number = 0;

  /**
   * Pushes a new sensor reading into the 2-second sliding window.
   */
  addReading(sample: MotionSample): MotionClassificationResult {
    this.windowBuffer.push(sample);

    // Maintain 100 samples (~2 seconds at 50Hz)
    if (this.windowBuffer.length > 100) {
      this.windowBuffer.shift();
    }

    return this.classifyCurrentState(sample.timestamp);
  }

  private classifyCurrentState(nowMs: number): MotionClassificationResult {
    if (this.windowBuffer.length < 10) {
      return {
        threatScore: 0,
        event: 'NORMAL',
        peakImpactG: 1.0,
        stillnessDurationSec: 0,
        erraticIndex: 0
      };
    }

    // 1. Calculate latest acceleration magnitude in Gs
    const latest = this.windowBuffer[this.windowBuffer.length - 1];
    const latestMagG = Math.sqrt(latest.ax ** 2 + latest.ay ** 2 + latest.az ** 2) / MotionClassifier.G;

    // Check for high-G impact
    if (latestMagG >= MotionClassifier.IMPACT_THRESHOLD_G) {
      this.lastImpactTimestamp = nowMs;
      this.peakImpactRecordedG = Math.max(this.peakImpactRecordedG, latestMagG);
    }

    // 2. Check stillness post-impact (Fall detection state machine)
    let stillnessDurationSec = 0;
    let isFallConfirmed = false;
    let isFallSuspected = false;

    if (this.lastImpactTimestamp !== null) {
      const elapsedSec = (nowMs - this.lastImpactTimestamp) / 1000.0;
      
      // Check if recent window is motionless near 1g
      let isStill = true;
      for (const s of this.windowBuffer.slice(-25)) {
        const magG = Math.sqrt(s.ax ** 2 + s.ay ** 2 + s.az ** 2) / MotionClassifier.G;
        if (Math.abs(magG - 1.0) > MotionClassifier.STILLNESS_TOLERANCE_G) {
          isStill = false;
          break;
        }
      }

      if (isStill) {
        stillnessDurationSec = elapsedSec;
        if (elapsedSec >= MotionClassifier.STILLNESS_REQUIRED_SEC) {
          isFallConfirmed = true;
        } else {
          isFallSuspected = true;
        }
      } else if (elapsedSec > 15.0) {
        // Impact occurred over 15s ago and user resumed moving normally -> reset impact
        this.lastImpactTimestamp = null;
        this.peakImpactRecordedG = 0;
      }
    }

    // 3. Struggle Detection (High jerk variance & high rotational energy)
    let jerkSum = 0;
    let gyroEnergy = 0;
    const count = this.windowBuffer.length;

    for (let i = 1; i < count; i++) {
      const prev = this.windowBuffer[i - 1];
      const curr = this.windowBuffer[i];
      const dt = (curr.timestamp - prev.timestamp) / 1000.0 || 0.02;

      const dax = (curr.ax - prev.ax) / dt;
      const day = (curr.ay - prev.ay) / dt;
      const daz = (curr.az - prev.az) / dt;
      jerkSum += Math.sqrt(dax ** 2 + day ** 2 + daz ** 2);

      gyroEnergy += Math.sqrt(curr.gx ** 2 + curr.gy ** 2 + curr.gz ** 2);
    }

    const meanJerk = jerkSum / Math.max(1, count - 1);
    const meanGyro = gyroEnergy / Math.max(1, count);
    const erraticIndex = (meanJerk / 20.0) + (meanGyro / 5.0);

    const isStruggle = erraticIndex > 2.5;

    // 4. Compute composite motion threat score (0-100)
    let threatScore = 5;
    let event: MotionClassificationResult['event'] = 'NORMAL';

    if (isFallConfirmed) {
      threatScore = 95;
      event = 'FALL_CONFIRMED';
    } else if (isStruggle) {
      threatScore = Math.min(90, Math.round(55 + erraticIndex * 10));
      event = 'STRUGGLE_DETECTED';
    } else if (isFallSuspected) {
      threatScore = Math.min(80, Math.round(40 + stillnessDurationSec * 4));
      event = 'FALL_SUSPECTED';
    } else {
      // Normal walking / jogging
      threatScore = Math.min(30, Math.round(erraticIndex * 10));
    }

    return {
      threatScore: Math.max(0, Math.min(100, threatScore)),
      event,
      peakImpactG: Number(this.peakImpactRecordedG.toFixed(2)),
      stillnessDurationSec: Number(stillnessDurationSec.toFixed(1)),
      erraticIndex: Number(erraticIndex.toFixed(2))
    };
  }

  reset(): void {
    this.windowBuffer = [];
    this.lastImpactTimestamp = null;
    this.peakImpactRecordedG = 0;
  }
}

export default new MotionClassifier();
