import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Fake incoming call: a believable excuse to leave an uncomfortable situation.
 * The "call" is entirely local: nothing is dialled and no network is used.
 * The optional recording (e.g. "Where are you? Come home now.") plays when the
 * call is answered, so the other side sounds real.
 */

export type FakeCallSettings = {
  callerName: string;
  callerLabel: string;     // shown under the name, e.g. "mobile"
  delaySeconds: number;
  recordingUri: string | null;
};

const SETTINGS_KEY = '@shield_fake_call_settings';
const RECORDING_PREFIX = 'fake-call-voice-';

export const DEFAULT_SETTINGS: FakeCallSettings = {
  callerName: 'Mom',
  callerLabel: 'mobile',
  delaySeconds: 10,
  recordingUri: null,
};

export async function loadSettings(): Promise<FakeCallSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: FakeCallSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// --- Voice recording for the "other side" ---------------------------------

let activeRecording: Audio.Recording | null = null;

export async function startVoiceRecording(): Promise<void> {
  const permission = await Audio.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Microphone permission is needed to record the caller voice.');
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  // The voice-SOS listeners give the microphone back when this screen opens, but stopping
  // takes a moment: retry briefly instead of failing on the first tap
  let lastError: unknown = null;
  for (let i = 0; i < 4; i++) {
    try {
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      activeRecording = recording;
      return;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('The microphone is busy. Try again in a moment.');
}

/** Stops recording and keeps the clip somewhere that survives app restarts. Returns its URI. */
export async function stopVoiceRecording(): Promise<string | null> {
  if (!activeRecording) return null;
  const recording = activeRecording;
  activeRecording = null;
  await recording.stopAndUnloadAsync();
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
  const tempUri = recording.getURI();
  if (!tempUri) throw new Error('Nothing was recorded.');
  // On web the recording is a blob URL (kept for this session only); on phones copy it to
  // app storage under a new name each time (a reused name could replay a cached old clip)
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return tempUri;
  const info = await FileSystem.getInfoAsync(tempUri);
  if (!info.exists || (info.size ?? 0) < 1000) throw new Error('The recording is empty. Hold the record button a little longer and speak.');
  const target = `${FileSystem.documentDirectory}${RECORDING_PREFIX}${Date.now()}.m4a`;
  await FileSystem.copyAsync({ from: tempUri, to: target });
  // keep only the newest clip
  try {
    const files = await FileSystem.readDirectoryAsync(FileSystem.documentDirectory);
    await Promise.all(files
      .filter((f) => f.startsWith(RECORDING_PREFIX) && `${FileSystem.documentDirectory}${f}` !== target)
      .map((f) => FileSystem.deleteAsync(`${FileSystem.documentDirectory}${f}`, { idempotent: true })));
  } catch { /* old clips stay; harmless */ }
  return target;
}

/** Whether a saved clip is still on the phone (settings can outlive a reinstall's files). */
export async function recordingExists(uri: string | null): Promise<boolean> {
  if (!uri) return false;
  if (Platform.OS === 'web') return true;
  try { return (await FileSystem.getInfoAsync(uri)).exists; } catch { return false; }
}

export async function deleteVoiceRecording(uri: string | null): Promise<void> {
  if (uri && Platform.OS !== 'web' && uri.startsWith(FileSystem.documentDirectory ?? '\0')) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}

// --- Ringtone ---------------------------------------------------------------

/** Fallback: a phone-style marimba ringtone (assets/sounds/ringtone.wav). */
const RINGTONE = require('../../assets/sounds/ringtone.wav');
/** The phone's own default ringtone (Android Settings.System.DEFAULT_RINGTONE_URI). */
const DEVICE_RINGTONE = 'content://settings/system/ringtone';

/**
 * Starts the looping ringtone and returns its stop function straight away, so a call that
 * is answered or declined while the sound is still loading also stops it (before, the stop
 * function only arrived after loading and an early tap left the ringtone playing).
 */
export function startRingtone(): () => Promise<void> {
  let stopped = false;
  let sound: Audio.Sound | null = null;
  (async () => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });
      // The phone's own ringtone, so the fake call sounds exactly like a real one; the
      // bundled tone when the phone has none set (or on iOS, which does not expose it)
      let created: { sound: Audio.Sound } | null = null;
      if (Platform.OS === 'android') {
        try {
          created = await Audio.Sound.createAsync({ uri: DEVICE_RINGTONE }, { isLooping: true, volume: 1.0, shouldPlay: !stopped });
        } catch (e) {
          console.warn('Device ringtone unavailable, using the bundled one', e);
        }
      }
      if (!created) created = await Audio.Sound.createAsync(RINGTONE, { isLooping: true, volume: 1.0, shouldPlay: !stopped });
      sound = created.sound;
      if (stopped) await sound.unloadAsync().catch(() => undefined);
    } catch (e) {
      console.warn('Ringtone unavailable; vibration only', e);
    }
  })();
  return async () => {
    stopped = true;
    const s = sound;
    sound = null;
    if (s) {
      try { await s.stopAsync(); await s.unloadAsync(); } catch { /* already unloaded */ }
    }
  };
}

/** Plays the recorded voice for an answered call. `speaker` false routes it to the earpiece on Android. */
export async function playCallerVoice(uri: string, speaker: boolean): Promise<Audio.Sound | null> {
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      allowsRecordingIOS: false,
      playThroughEarpieceAndroid: !speaker,
    });
    const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true, volume: 1.0 });
    return sound;
  } catch (e) {
    console.warn('Could not play caller voice', e);
    return null;
  }
}

export async function setSpeaker(speaker: boolean): Promise<void> {
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, playThroughEarpieceAndroid: !speaker });
  } catch {
    // routing not supported on this platform
  }
}
