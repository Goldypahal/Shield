import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { subscribeMotion, ShakeDetector } from '../services/motionHub';

/**
 * Calls onShake when the phone is shaken hard for about a second (see ShakeDetector).
 * Listens only while `enabled`. Uses the shared 50 Hz motion stream, so it no longer
 * slows the fall detector's sensor rate down.
 */
export function useShakeTrigger(onShake: () => void, enabled = true) {
  const callback = useRef(onShake);
  callback.current = onShake;

  useEffect(() => {
    if (!enabled) return;
    const detector = new ShakeDetector();

    // Mobile browsers: devicemotion (m/s^2, gravity included)
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      const onMotion = (e: DeviceMotionEvent) => {
        const a = e.accelerationIncludingGravity;
        if (!a) return;
        if (detector.push({ ax: (a.x || 0) / 9.81, ay: (a.y || 0) / 9.81, az: (a.z || 0) / 9.81, t: Date.now() })) callback.current();
      };
      window.addEventListener('devicemotion', onMotion);
      return () => window.removeEventListener('devicemotion', onMotion);
    }

    return subscribeMotion((s) => {
      if (detector.push(s)) {
        console.log('[ShakeTrigger] deliberate shake detected -> SOS');
        callback.current();
      }
    });
  }, [enabled]);
}
