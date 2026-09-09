import { useEffect, useRef, useState } from 'react';
import { UserProfile } from '../types';
import { calculateThreatScore, isNightTime } from '../services/threatEngine';
import { getAudioThreatScore } from '../services/audioService';
import { getMotionThreatScore } from '../services/motionService';

export function useThreatMonitor(profile: UserProfile | null, onThreat: (score: number, level: 'LOW' | 'MEDIUM' | 'HIGH') => void) {
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('LOW');
  const running = useRef(true);

  useEffect(() => {
    running.current = true;

    async function loop() {
      while (running.current && profile) {
        const audioScore = await getAudioThreatScore();
        const motionScore = await getMotionThreatScore();

        const result = calculateThreatScore(
          {
            audioScore,
            motionScore,
            heartRateScore: 0,
            routineDeviationScore: 0,
            nightMultiplier: isNightTime() ? 1.2 : 1.0,
            manualSOS: false
          },
          profile.sensitivityMode
        );

        setScore(result.totalScore);
        setLevel(result.level);

        if (result.shouldTrigger) {
          onThreat(result.totalScore, result.level);
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    loop();

    return () => {
      running.current = false;
    };
  }, [profile, onThreat]);

  return { score, level };
}
