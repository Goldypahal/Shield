import { useEffect, useRef } from 'react';
import { Accelerometer } from 'expo-sensors';

export function useShakeTrigger(onShake: () => void) {
  const lastShakeTime = useRef(0);
  const shakeCount = useRef(0);

  useEffect(() => {
    Accelerometer.setUpdateInterval(250);

    const sub = Accelerometer.addListener(({ x, y, z }) => {
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
          onShake();
        }
      }
    });

    return () => sub.remove();
  }, [onShake]);
}
