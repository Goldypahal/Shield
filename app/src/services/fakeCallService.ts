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
const RECORDING_FILE = 'fake-call-voice.m4a';

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
  const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  activeRecording = recording;
}

/** Stops recording and keeps the clip somewhere that survives app restarts. Returns its URI. */
export async function stopVoiceRecording(): Promise<string | null> {
  if (!activeRecording) return null;
  const recording = activeRecording;
  activeRecording = null;
  await recording.stopAndUnloadAsync();
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
  const tempUri = recording.getURI();
  if (!tempUri) return null;
  // On web the recording is a blob URL (kept for this session only); on phones copy it to app storage
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return tempUri;
  const target = `${FileSystem.documentDirectory}${RECORDING_FILE}`;
  await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.copyAsync({ from: tempUri, to: target });
  return target;
}

export async function deleteVoiceRecording(uri: string | null): Promise<void> {
  if (uri && Platform.OS !== 'web' && uri.startsWith(FileSystem.documentDirectory ?? '\0')) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}

// --- Ringtone ---------------------------------------------------------------

/**
 * Builds a classic phone ring (440 Hz + 480 Hz, ring-ring then pause) as a WAV,
 * so the feature needs no bundled audio asset.
 */
function buildRingtoneWavBase64(): string {
  const sampleRate = 8000;
  const pattern: Array<[number, boolean]> = [[0.4, true], [0.2, false], [0.4, true], [2.0, false]];
  const total = Math.round(pattern.reduce((s, [d]) => s + d, 0) * sampleRate);
  const bytes = new Uint8Array(44 + total * 2);
  const view = new DataView(bytes.buffer);
  const writeStr = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i); };

  writeStr(0, 'RIFF'); view.setUint32(4, 36 + total * 2, true); writeStr(8, 'WAVE');
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, 'data'); view.setUint32(40, total * 2, true);

  let i = 0;
  for (const [duration, on] of pattern) {
    const n = Math.round(duration * sampleRate);
    for (let k = 0; k < n; k++, i++) {
      const t = i / sampleRate;
      const v = on ? 0.35 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t)) : 0;
      view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 32767, true);
    }
  }
  return toBase64(bytes);
}

function toBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    out += chars[(triple >> 18) & 63] + chars[(triple >> 12) & 63]
      + (i + 1 < bytes.length ? chars[(triple >> 6) & 63] : '=')
      + (i + 2 < bytes.length ? chars[triple & 63] : '=');
  }
  return out;
}

let ringtoneUri: string | null = null;

async function getRingtoneUri(): Promise<string> {
  if (ringtoneUri) return ringtoneUri;
  const b64 = buildRingtoneWavBase64();
  if (Platform.OS === 'web' || !FileSystem.cacheDirectory) {
    ringtoneUri = `data:audio/wav;base64,${b64}`;
  } else {
    ringtoneUri = `${FileSystem.cacheDirectory}fake-call-ring.wav`;
    await FileSystem.writeAsStringAsync(ringtoneUri, b64, { encoding: FileSystem.EncodingType.Base64 });
  }
  return ringtoneUri;
}

/** Starts the looping ringtone; resolves to a stop function. */
export async function startRingtone(): Promise<() => Promise<void>> {
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
    const { sound } = await Audio.Sound.createAsync({ uri: await getRingtoneUri() }, { isLooping: true, volume: 1.0 });
    await sound.playAsync();
    return async () => {
      try { await sound.stopAsync(); await sound.unloadAsync(); } catch { /* already unloaded */ }
    };
  } catch (e) {
    console.warn('Ringtone unavailable; vibration only', e);
    return async () => undefined;
  }
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
