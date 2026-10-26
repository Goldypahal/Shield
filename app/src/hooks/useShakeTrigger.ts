import { useEffect, useRef } from 'react';
import { Accelerometer } from 'expo-sensors';

/** Calls onShake after three hard shakes within ~1 s of each other. Listens only while `enabled`. */
export function useShakeTrigger(onShake: () => void, enabled = true) {
  const lastShakeTime = useRef(0);
  const shakeCount = useRef(0);
  const callback = useRef(onShake);
  callback.current = onShake;

  useEffect(() => {
    if (!enabled) return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;

    Accelerometer.isAvailableAsync()
      .then((available) => {
        if (!available || cancelled) return;
        Accelerometer.setUpdateInterval(250);
        sub = Accelerometer.addListener(({ x, y, z }) => {
          const magnitude = Math.sqrt(x * x + y * y + z * z);
          const now = Date.now();

          if (magnitude > 1.9) {
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
