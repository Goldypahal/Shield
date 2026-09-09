import { ThreatResult, ThreatSignals } from '../types';

export function isNightTime() {
  const hour = new Date().getHours();
  return hour >= 20 || hour < 6;
}

export function calculateThreatScore(
  signals: ThreatSignals,
  sensitivityMode: 'NORMAL' | 'HIGH_ALERT'
): ThreatResult {
  const weights = sensitivityMode === 'HIGH_ALERT'
    ? { audio: 0.35, motion: 0.3, heart: 0.15, routine: 0.2 }
    : { audio: 0.3, motion: 0.3, heart: 0.15, routine: 0.15 };

  const base =
    signals.audioScore * weights.audio +
    signals.motionScore * weights.motion +
    signals.heartRateScore * weights.heart +
    signals.routineDeviationScore * weights.routine;

  const manualBoost = signals.manualSOS ? 40 : 0;
  const totalScore = Math.min(
    100,
    Math.round(base * signals.nightMultiplier + manualBoost)
  );

  const level: 'LOW' | 'MEDIUM' | 'HIGH' =
    totalScore >= 75 ? 'HIGH' : totalScore >= 40 ? 'MEDIUM' : 'LOW';

  const threshold = sensitivityMode === 'HIGH_ALERT' ? 60 : 70;

  return {
    totalScore,
    level,
    shouldTrigger: totalScore >= threshold,
    breakdown: signals
  };
}
