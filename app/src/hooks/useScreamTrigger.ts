import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import type { AudioDataEvent, UseAudioRecorderState } from '@siteed/audio-studio';
import { optionalNative } from '../utils/nativeModules';
import audioClassifier, { AudioClassifier } from '../ml/AudioClassifier';
import { ScreamDurationDetector } from '../ml/ScreamDurationDetector';
import ScreamSosController from '../services/screamSosController';
import {
  onVoiceSosTrigger,
  getVoiceSupportInfo,
  reportHeardPhrase,
  getActiveMediaStream,
  onActiveMediaStream,
} from '../services/voiceTriggerHelper';

// The microphone stream needs native code that Expo Go lacks; without it scream detection is off.
const audioStudio = optionalNative(
  () => require('@siteed/audio-studio') as typeof import('@siteed/audio-studio'),
  'Microphone streaming (@siteed/audio-studio)',
);
export const screamDetectionAvailable = audioStudio !== null || (Platform.OS as string) === 'web';

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
 * Listens to the microphone while `enabled` and calls `onScream` once a scream
 * or emergency distress keyword is detected.
 *
 * Supports:
 * 1. Native @siteed/audio-studio 3-second sustained scream classifier with background service.
 * 2. Web Speech Recognition for emergency keywords ("Help me", "Emergency", "SOS").
 * 3. Web Audio API decibel / scream frequency analyzer.
 * 4. Synthetic voice test dispatch for instant UI verification.
 */
export function useScreamTrigger(
  onScream: () => void,
  enabled: boolean,
  options: ScreamTriggerOptions = {}
) {
  const { startRecording, stopRecording } = useRecorder();
  const background = options.background ?? false;
  const onScreamRef = useRef(onScream);
  const onProgressRef = useRef(options.onProgress);
  onScreamRef.current = onScream;
  const lastTriggerTime = useRef(0);
  const safeTriggerScream = (reason: string) => {
    const now = Date.now();
    if (now - lastTriggerTime.current < 5000) {
      console.log(`[ScreamTrigger] Cooldown active (ignoring ${reason})`);
      return;
    }
    lastTriggerTime.current = now;
    console.log(`[ScreamTrigger] Triggering SOS: ${reason}`);
    onScreamRef.current();
  };

  // Listen for synthetic or test triggers
  useEffect(() => {
    if (!enabled) return;
    const unsub = onVoiceSosTrigger(() => {
      console.log('[ScreamTrigger] Voice SOS triggered via event!');
      safeTriggerScream('voice_sos_event');
    });
    return unsub;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let started = false;
    let busy = false;
    const ring = new Float32Array(WINDOW);
    let filled = 0;
    const detector = new ScreamDurationDetector();

    // WEB PLATFORM: Managed centrally via voiceTriggerHelper and onVoiceSosTrigger
    if (Platform.OS === 'web') {
      return () => {
        stopped = true;
      };
    }

    // NATIVE PLATFORM IMPLEMENTATION (@siteed/audio-studio)
    const onAudioStream = async (event: AudioDataEvent) => {
      if (stopped) return;
      ScreamSosController.tick(); // keeps a countdown moving while timers are paused
      const chunk = toFloat32(event.data as AudioDataEvent['data']);
      if (chunk.length === 0) return;

      // Slide the newest samples into the 1 s window
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
        if (Platform.OS !== 'web' && audioStudio) {
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
          output: { primary: { enabled: false } },
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

    if ((Platform.OS as string) === 'web' || AppState.currentState === 'active') {
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
  }, [enabled, background]);
}
