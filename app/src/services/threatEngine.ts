import { ThreatResult, ThreatSignals, SRSThreatSignals, DistressState } from '../types';

export function isNightTime(): boolean {
  const hour = new Date().getHours();
  return hour >= 20 || hour < 6;
}

/**
 * SRS Section 6.2 Composite Threat Engine:
 * S = (0.45 * Audio + 0.30 * Motion + 0.25 * Context) * M_night + manual_boost
 * 
 * Where:
 * - Audio: 0-100 on-device distress score
 * - Motion: 0-100 fall/struggle detection score
 * - Context: 0-100 route risk & environmental context score
 * - M_night = 1.2 (from 20:00 to 06:00), 1.0 during daytime
 * - manual_boost = +40 if panic button pressed
 * 
 * Dynamic Threshold:
 * - 70 normally
 * - 60 when current segment safety score < 40 (caution stretch) or sensitivityMode is HIGH_ALERT
 */
export function calculateThreatScore(
  signals: SRSThreatSignals | ThreatSignals,
  sensitivityMode: 'NORMAL' | 'HIGH_ALERT' = 'NORMAL'
): ThreatResult {
  const audio = signals.audioScore || 0;
  const motion = signals.motionScore || 0;
  
  // Resolve context score: direct contextScore or weighted heart/routine fallbacks
  let context = 0;
  if ('contextScore' in signals && signals.contextScore !== undefined) {
    context = signals.contextScore;
  } else {
    const heart = ('heartRateScore' in signals ? signals.heartRateScore : 0) || 0;
    const routine = ('routineDeviationScore' in signals ? signals.routineDeviationScore : 0) || 0;
    context = Math.round(0.5 * heart + 0.5 * routine);
  }

  // SRS 6.2 Weights: 0.45 Audio, 0.30 Motion, 0.25 Context
  const compositeBase = 0.45 * audio + 0.30 * motion + 0.25 * context;

  // Night Multiplier M_night = 1.2
  const night = signals.isNight !== undefined ? signals.isNight : (signals.nightMultiplier ? signals.nightMultiplier > 1.0 : isNightTime());
  const mNight = night ? 1.2 : 1.0;

  // Manual SOS Boost = +40
  const manualBoost = signals.manualSOS ? 40 : 0;

  // Total Threat Score clamped [0, 100]
  const totalScore = Math.min(100, Math.max(0, Math.round(compositeBase * mNight + manualBoost)));

  // Dynamic Trigger Threshold:
  // 60 when segment score < 40 (caution stretch) or HIGH_ALERT, else 70
  const segmentScore = ('segmentSafetyScore' in signals && signals.segmentSafetyScore !== undefined) 
    ? signals.segmentSafetyScore 
    : 100;
  const threshold = (segmentScore < 40 || sensitivityMode === 'HIGH_ALERT') ? 60 : 70;

  const shouldTrigger = totalScore >= threshold;
  const level: 'LOW' | 'MEDIUM' | 'HIGH' =
    totalScore >= 75 ? 'HIGH' : totalScore >= 40 ? 'MEDIUM' : 'LOW';

  const state: DistressState = shouldTrigger 
    ? (signals.manualSOS ? 'ACTIVE' : 'PRE_ALERT')
    : (totalScore >= 50 ? 'SUSPECTED' : 'MONITORING');

  return {
    totalScore,
    level,
    shouldTrigger,
    threshold,
    state,
    breakdown: {
      audioScore: audio,
      motionScore: motion,
      contextScore: context,
      mNight,
      manualBoost,
      segmentSafetyScore: segmentScore,
      compositeBase: Math.round(compositeBase)
    }
  };
}
