import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Discreet-SOS preferences. The app can open as a working calculator (typing the SOS PIN
 * and "=" unlocks it; the duress PIN and "=" sends a silent SOS), and shaking the phone
 * can start the SOS countdown. Both are off by default.
 */
export interface DiscreetSettings {
  calculatorDisguise: boolean;
  shakeToSos: boolean;
}

const KEY = '@shield_discreet_settings';
const DEFAULTS: DiscreetSettings = { calculatorDisguise: false, shakeToSos: false };
const listeners = new Set<(s: DiscreetSettings) => void>();

export async function getDiscreetSettings(): Promise<DiscreetSettings> {
  try {
    return { ...DEFAULTS, ...JSON.parse((await AsyncStorage.getItem(KEY)) || '{}') };
  } catch {
    return DEFAULTS;
  }
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
