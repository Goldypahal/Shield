import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { Accelerometer } from 'expo-sensors';

/** Calls onShake after three hard shakes within ~1.2 s of each other. Listens only while `enabled`. */
export function useShakeTrigger(onShake: () => void, enabled = true) {
  const lastShakeTime = useRef(0);
  const shakeCount = useRef(0);
  const callback = useRef(onShake);
  callback.current = onShake;

  useEffect(() => {
    if (!enabled) return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;

    const handleShake = () => {
      const now = Date.now();
      const delta = now - lastShakeTime.current;
      if (delta < 280) {
        // Human hand cannot reverse shake direction in under 280ms; ignore same-motion jitter
        return;
      }
      if (delta <= 1400) {
        shakeCount.current += 1;
      } else {
        shakeCount.current = 1;
      }
      lastShakeTime.current = now;

      if (shakeCount.current >= 3) {
        shakeCount.current = 0;
        console.log('[ShakeTrigger] 3 vigorous deliberate shakes detected -> Triggering SOS');
        callback.current();
      }
    };

    // Web browser fallback for devicemotion (mobile Chrome/Safari)
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const onDeviceMotion = (e: DeviceMotionEvent) => {
        if (cancelled) return;
        let magnitude = 0;
        if (e.acceleration && (e.acceleration.x !== null || e.acceleration.y !== null)) {
          const ax = e.acceleration.x || 0;
          const ay = e.acceleration.y || 0;
          const az = e.acceleration.z || 0;
          magnitude = Math.sqrt(ax * ax + ay * ay + az * az) / 9.8; // in G's
        } else if (e.accelerationIncludingGravity) {
          const gx = (e.accelerationIncludingGravity.x || 0) / 9.8;
          const gy = (e.accelerationIncludingGravity.y || 0) / 9.8;
          const gz = (e.accelerationIncludingGravity.z || 0) / 9.8;
          const totalG = Math.sqrt(gx * gx + gy * gy + gz * gz);
          magnitude = Math.abs(totalG - 1.0); // delta from 1G stationary gravity
        }

        // Require vigorous intentional shaking (> 2.0 G above rest)
        if (magnitude > 2.0) {
          handleShake();
        }
      };

      try {
        window.addEventListener('devicemotion', onDeviceMotion);
      } catch (_) {}

      return () => {
        cancelled = true;
        try {
          window.removeEventListener('devicemotion', onDeviceMotion);
        } catch (_) {}
      };
    }

    // Native accelerometer (iOS & Android native build)
    Accelerometer.isAvailableAsync()
      .then((available) => {
        if (!available || cancelled) return;
        Accelerometer.setUpdateInterval(250);
        sub = Accelerometer.addListener(({ x, y, z }) => {
          const magnitude = Math.sqrt(x * x + y * y + z * z);
          if (magnitude > 1.9) {
            handleShake();
          }
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);
}
