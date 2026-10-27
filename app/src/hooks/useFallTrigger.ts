import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import FallModel, { FALL_MODEL_THRESHOLD } from '../ml/FallModel';
import { FallDetector, FALL_FS } from '../ml/FallDetector';

const G = 9.80665;
const INTERVAL_MS = Math.round(1000 / FALL_FS); // 20 ms = 50 Hz, what the model was trained on

/**
 * Watches the accelerometer and gyroscope while `enabled` and calls `onFall` once the
 * fall model has seen an impact AND the phone then lay still for 3 s (see FallDetector).
 *
 * Sensors run only while the app is open: Android and iOS stop delivering them to a
 * backgrounded app, so pass `enabled` false when the app is in the background.
 * Without the native TFLite runtime (Expo Go, web) nothing is started.
 */
export function useFallTrigger(onFall: () => void, enabled: boolean) {
  const onFallRef = useRef(onFall);
  onFallRef.current = onFall;

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    let cancelled = false;
    let accSub: { remove: () => void } | null = null;
    let gyroSub: { remove: () => void } | null = null;
    const gyro = { x: 0, y: 0, z: 0 };
    const detector = new FallDetector((w) => FallModel.predict(w), { threshold: FALL_MODEL_THRESHOLD });

    (async () => {
      const [ok, accOk, gyroOk] = await Promise.all([
        FallModel.load(),
        Accelerometer.isAvailableAsync().catch(() => false),
        Gyroscope.isAvailableAsync().catch(() => false),
      ]);
      if (cancelled || !ok || !accOk) return;
      if (gyroOk) {
        Gyroscope.setUpdateInterval(INTERVAL_MS);
        gyroSub = Gyroscope.addListener((g) => { gyro.x = g.x; gyro.y = g.y; gyro.z = g.z; });
      }
      Accelerometer.setUpdateInterval(INTERVAL_MS);
      accSub = Accelerometer.addListener(({ x, y, z }) => {
        detector
          .push({ ax: x * G, ay: y * G, az: z * G, gx: gyro.x, gy: gyro.y, gz: gyro.z }, Date.now())
          .then((status) => { if (status.fallConfirmed && !cancelled) onFallRef.current(); })
          .catch((e) => console.warn('[FallTrigger] detection failed', e));
      });
    })();

    return () => {
      cancelled = true;
      accSub?.remove();
      gyroSub?.remove();
    };
  }, [enabled]);
}
