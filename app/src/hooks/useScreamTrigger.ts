import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import type { AudioDataEvent, UseAudioRecorderState } from '@siteed/audio-studio';
import { optionalNative } from '../utils/nativeModules';
import audioClassifier, { AudioClassifier } from '../ml/AudioClassifier';
import { ScreamDurationDetector } from '../ml/ScreamDurationDetector';
import ScreamSosController from '../services/screamSosController';

// The microphone stream needs native code that Expo Go lacks; without it scream detection is off.
const audioStudio = optionalNative(
  () => require('@siteed/audio-studio') as typeof import('@siteed/audio-studio'),
  'Microphone streaming (@siteed/audio-studio)',
);
export const screamDetectionAvailable = audioStudio !== null;

const noRecorder = (): Pick<UseAudioRecorderState, 'startRecording' | 'stopRecording'> => ({
  startRecording: async () => { throw new Error('Microphone streaming needs a development build'); },
  stopRecording: async () => { throw new Error('not recording'); },
});
// Chosen once at load time, so the hook order never changes between renders
const useRecorder = audioStudio ? audioStudio.useAudioRecorder : noRecorder;

const SAMPLE_RATE = 16000;
const HOP_MS = 500;
const WINDOW = AudioClassifier.SAMPLES_PER_WINDOW; // latest 1 s of audio per classification

/** Native may still hand over base64 16-bit PCM; normalise everything to [-1, 1] floats. */
function toFloat32(data: AudioDataEvent['data'] | number[]): Float32Array {
  if (data instanceof Float32Array) return data;
  if (Array.isArray(data)) return Float32Array.from(data);
  if (data instanceof Int16Array) {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i] / 32768;
    return out;
  }
  const bin = globalThis.atob(data);
  const out = new Float32Array(bin.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    out[i] = (v >= 0x8000 ? v - 0x10000 : v) / 32768;
  }
  return out;
}

export interface ScreamTriggerOptions {
  /** Live progress, e.g. for a "listening" indicator. */
  onProgress?: (sustainedMs: number) => void;
  /**
   * Keep listening with the app in the background or the screen off. Android runs the
   * microphone in a foreground service with a permanent notification (required by Android);
   * iOS keeps the audio session alive (background audio mode).
   */
  background?: boolean;
}

/**
 * Listens to the microphone while `enabled` and calls `onScream` once the scream model
 * has heard a scream for about 3 seconds (see ScreamDurationDetector).
 *
 * Audio is streamed in 500 ms hops at 16 kHz mono and held only in a 1 s ring buffer
 * in memory (SRS DET-8): no file is written. The microphone is released whenever
 * `enabled` turns false, so pass false while an SOS, a call or other recording runs.
 *
 * Every chunk also advances a running scream-SOS countdown: in the background Android
 * pauses JavaScript timers, but microphone events keep arriving.
 *
 * The microphone can only be started while the app is on screen (Android forbids starting a
 * microphone foreground service from the background), so a start requested in the
 * background waits until the app is opened again.
 */
export function useScreamTrigger(onScream: () => void, enabled: boolean, options: ScreamTriggerOptions = {}) {
  const { startRecording, stopRecording } = useRecorder();
  const background = options.background ?? false;
  const onScreamRef = useRef(onScream);
  const onProgressRef = useRef(options.onProgress);
  onScreamRef.current = onScream;
  onProgressRef.current = options.onProgress;

  useEffect(() => {
    if (!enabled || !audioStudio) return;
    let stopped = false;
    let started = false;
    let busy = false;
    const ring = new Float32Array(WINDOW);
    let filled = 0;
    const detector = new ScreamDurationDetector();
    audioClassifier.load(); // warm the TFLite model before the first window arrives

    const onAudioStream = async (event: AudioDataEvent) => {
      if (stopped) return;
      ScreamSosController.tick(); // keeps a countdown moving while timers are paused
      const chunk = toFloat32(event.data as AudioDataEvent['data']);
      if (chunk.length === 0) return;

      // Slide the newest samples into the 0.975 s window
      if (chunk.length >= WINDOW) {
        ring.set(chunk.subarray(chunk.length - WINDOW));
      } else {
        ring.copyWithin(0, chunk.length);
        ring.set(chunk, WINDOW - chunk.length);
      }
      filled = Math.min(WINDOW, filled + chunk.length);
      if (filled < WINDOW || busy) return;

      busy = true;
      try {
        const probability = await audioClassifier.classifyWindow(ring.slice());
        if (stopped) return;
        const hopMs = Math.max(HOP_MS, Math.round((chunk.length / SAMPLE_RATE) * 1000));
        const status = detector.push(probability, Date.now(), hopMs, audioClassifier.threshold);
        onProgressRef.current?.(status.sustainedMs);
        if (status.triggered) onScreamRef.current();
      } catch (e) {
        console.warn('[ScreamTrigger] classification failed', e);
      } finally {
        busy = false;
      }
    };

    let waitForForeground: { remove: () => void } | null = null;

    const start = async () => {
      try {
        if (Platform.OS !== 'web') {
          const perm = await audioStudio.AudioStudioModule.requestPermissionsAsync();
          if (!perm?.granted) {
            console.warn('[ScreamTrigger] Microphone permission denied; scream detection is off.');
            return;
          }
        }
        if (stopped) return;
        await startRecording({
          sampleRate: SAMPLE_RATE,
          channels: 1,
          encoding: 'pcm_16bit',
          interval: HOP_MS,
          bufferDurationSeconds: 0.1,
          streamFormat: 'float32',
          keepFullAnalysis: false,
          output: { primary: { enabled: false } }, // stream only, never written to disk
          onAudioStream,
          // Background listening: a microphone foreground service on Android, with the
          // notification Android requires; on iOS the audio session stays active.
          keepAwake: background,
          showNotification: background && Platform.OS === 'android',
          notification: {
            title: 'SHIELD is listening for screams',
            text: 'A 3-second scream starts an SOS. Audio is analysed on your phone and not stored.',
            android: {
              channelId: 'scream-listening',
              channelName: 'Scream detection',
              channelDescription: 'Shown while SHIELD listens for screams in the background.',
              priority: 'low',
              showPauseResumeActions: false,
            },
          },
          android: { audioFocusStrategy: background ? 'background' : 'interactive' },
          ios: {
            audioSession: {
              category: 'PlayAndRecord',
              categoryOptions: ['MixWithOthers', 'DefaultToSpeaker', 'AllowBluetooth'],
            },
          },
        });
        started = true;
        if (stopped) stopRecording().catch(() => undefined);
      } catch (e) {
        console.warn('[ScreamTrigger] Could not start the microphone; scream detection is off.', e);
      }
    };

    if (Platform.OS === 'web' || AppState.currentState === 'active') {
      start();
    } else {
      waitForForeground = AppState.addEventListener('change', (next) => {
        if (next !== 'active' || stopped) return;
        waitForForeground?.remove();
        waitForForeground = null;
        start();
      });
    }

    return () => {
      stopped = true;
      waitForForeground?.remove();
      onProgressRef.current?.(0);
      if (started) stopRecording().catch(() => undefined);
    };
    // startRecording/stopRecording are stable for the recorder's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, background]);
}
