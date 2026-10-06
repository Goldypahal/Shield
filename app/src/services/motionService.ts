import { Accelerometer } from 'expo-sensors';
import MotionClassifier, { MotionClassificationResult } from '../ml/MotionClassifier';

let latestResult: MotionClassificationResult = {
  threatScore: 0,
  event: 'NORMAL',
  peakImpactG: 1.0,
  stillnessDurationSec: 0,
  erraticIndex: 0
};
let subscribed = false;

function ensureSubscription() {
  if (subscribed) return;

  subscribed = true;
  // Sample at 50Hz (20ms) for impact & fall detection per SRS DET-5
  Accelerometer.setUpdateInterval(50);
  Accelerometer.addListener(({ x, y, z }) => {
    // Convert g-force to m/s^2 for classifier
    const G = 9.80665;
    latestResult = MotionClassifier.addReading({
      ax: x * G,
      ay: y * G,
      az: z * G,
      gx: 0.0,
      gy: 0.0,
      gz: 0.0,
      timestamp: Date.now()
    });
  });
}

/**
 * Returns latest motion threat score [0, 100] derived from
 * SRS DET-5 impact (>2.5g) + 10s stillness or sustained erratic motion.
 */
export async function getMotionThreatScore(): Promise<number> {
  ensureSubscription();
  return latestResult.threatScore;
}

export function getLatestMotionEvent(): MotionClassificationResult {
  return { ...latestResult };
}

export function resetMotionDetector(): void {
  MotionClassifier.reset();
}
