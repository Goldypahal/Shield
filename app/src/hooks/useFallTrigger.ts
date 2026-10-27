import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import FallModel, { FALL_MODEL_THRESHOLD } from '../ml/FallModel';
import { FallDetector } from '../ml/FallDetector';
import { subscribeMotion } from '../services/motionHub';
import { setDetectorStatus } from '../services/detectorStatus';

const G = 9.80665;

/**
 * Watches the motion sensors while `enabled` and calls `onFall` once an impact (the fall
 * model, or free fall followed by a hard landing) is followed by the phone lying still
 * for 3 s (see FallDetector).
 *
 * Uses the shared 50 Hz stream (motionHub), so shake detection can no longer slow it down.
 * Sensors only reach an open app, so `enabled` is false in the background. When the
 * TFLite model cannot load, the free-fall + impact path still works.
 */
export function useFallTrigger(onFall: () => void, enabled: boolean) {
  const onFallRef = useRef(onFall);
  onFallRef.current = onFall;

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') {
      setDetectorStatus({ fall: 'off' });
      return;
    }
    let cancelled = false;
    const detector = new FallDetector((w) => FallModel.predict(w), { threshold: FALL_MODEL_THRESHOLD });
    FallModel.load().then((ok) => {
      if (!cancelled) setDetectorStatus({ fall: ok ? 'model' : 'physics' });
    });
    const unsubscribe = subscribeMotion((s) => {
      detector
        .push({ ax: s.ax * G, ay: s.ay * G, az: s.az * G, gx: s.gx, gy: s.gy, gz: s.gz }, s.t)
        .then((status) => {
          if (status.fallConfirmed && !cancelled) {
            console.log(`[FallTrigger] fall confirmed (impact by ${detector.lastImpactBy}) -> SOS`);
            onFallRef.current();
          }
        })
        .catch((e) => console.warn('[FallTrigger] detection failed', e));
    });
    return () => {
      cancelled = true;
      unsubscribe();
      setDetectorStatus({ fall: 'off' });
    };
  }, [enabled]);
}
