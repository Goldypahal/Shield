import { Accelerometer } from 'expo-sensors';

let latestMagnitude = 0;
let subscribed = false;

function ensureSubscription() {
  if (subscribed) return;

  subscribed = true;
  Accelerometer.setUpdateInterval(400);
  Accelerometer.addListener(({ x, y, z }) => {
    latestMagnitude = Math.sqrt(x * x + y * y + z * z);
  });
}

// Lightweight fallback until TFLite + sequence modeling is added.
export async function getMotionThreatScore(): Promise<number> {
  ensureSubscription();

  const deltaFromRest = Math.abs(latestMagnitude - 1);
  if (deltaFromRest >= 1.2) return 85;
  if (deltaFromRest >= 0.8) return 60;
  if (deltaFromRest >= 0.45) return 35;
  return 5;
}
