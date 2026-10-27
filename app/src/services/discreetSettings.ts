import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Discreet-SOS preferences. The app can open as a working calculator (typing the SOS PIN
 * and "=" unlocks it; the duress PIN and "=" sends a silent SOS), and shaking the phone
 * can start the SOS countdown. Both are off by default. Scream detection (a ~3 s scream
 * starts the 10 s SOS countdown) is on by default and can be turned off. It keeps
 * listening when the app is in the background (screamInBackground), shown by a permanent
 * notification, unless the walker turns that off.
 */
export interface DiscreetSettings {
  calculatorDisguise: boolean;
  shakeToSos: boolean;
  screamToSos: boolean;
  /** Keep listening for screams with the app in the background or the screen off. */
  screamInBackground: boolean;
  /** A fall (fall model + lying still afterwards) starts the SOS countdown; app open only. */
  fallToSos: boolean;
  /** Spoken cries for help ("help", "bachao", "call the police") start the SOS countdown; app open only. */
  keywordToSos: boolean;
  /**
   * The walker's normal speaking level in dB (measured with "Calibrate my voice"), or null
   * for the default (60 dB, ordinary conversation at arm's length).
   */
  voiceBaselineDb: number | null;
  /** How much louder than normal speech counts as a cry: trigger level = baseline x (1 + pct/100). */
  voiceRaisePct: number;
  /** Keywords only count when said in a raised voice (at or above the trigger level). */
  keywordNeedsLoud: boolean;
  /** Version of the defaults this install has seen (for one-time default changes). */
  defaultsVersion?: number;
}

const KEY = '@shield_discreet_settings';
export const DEFAULT_SPEECH_DB = 60;
export const DEFAULTS: DiscreetSettings = {
  calculatorDisguise: false, shakeToSos: true, screamToSos: true, screamInBackground: true, fallToSos: true, keywordToSos: true,
  voiceBaselineDb: null, voiceRaisePct: 15, keywordNeedsLoud: true, defaultsVersion: 2,
};
const listeners = new Set<(s: DiscreetSettings) => void>();

export async function getDiscreetSettings(): Promise<DiscreetSettings> {
  try {
    const stored = JSON.parse((await AsyncStorage.getItem(KEY)) || '{}');
    // v2: shake to SOS is on by default (it used to be off, so most installs had it off
    // without ever choosing that). Applied once; turning it off afterwards sticks.
    if ((stored.defaultsVersion ?? 1) < 2) {
      stored.shakeToSos = true;
      stored.defaultsVersion = 2;
      AsyncStorage.setItem(KEY, JSON.stringify({ ...DEFAULTS, ...stored })).catch(() => undefined);
    }
    return { ...DEFAULTS, ...stored };
  } catch {
    return DEFAULTS;
  }
}

/** The level (dB) at or above which a voice counts as raised: normal speech + voiceRaisePct. */
export function triggerLevelDb(s: Pick<DiscreetSettings, 'voiceBaselineDb' | 'voiceRaisePct'>): number {
  const base = s.voiceBaselineDb ?? DEFAULT_SPEECH_DB;
  return Math.round(base * (1 + s.voiceRaisePct / 100) * 10) / 10;
}

export async function updateDiscreetSettings(patch: Partial<DiscreetSettings>): Promise<DiscreetSettings> {
  const next = { ...(await getDiscreetSettings()), ...patch };
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l(next));
  return next;
}

export function onDiscreetSettingsChange(listener: (s: DiscreetSettings) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
