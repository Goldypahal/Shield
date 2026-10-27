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
      if (now - lastShakeTime.current < 1200) {
        shakeCount.current += 1;
      } else {
        shakeCount.current = 1;
      }
      lastShakeTime.current = now;

      if (shakeCount.current >= 3) {
        shakeCount.current = 0;
        callback.current();
      }
    };

    // Web browser fallback for devicemotion (mobile Chrome/Safari)
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const onDeviceMotion = (e: DeviceMotionEvent) => {
        if (cancelled) return;
        const acc = e.accelerationIncludingGravity || e.acceleration;
        if (!acc) return;
        const x = (acc.x || 0) / 9.8;
        const y = (acc.y || 0) / 9.8;
        const z = (acc.z || 0) / 9.8;
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        if (magnitude > 1.8) {
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
