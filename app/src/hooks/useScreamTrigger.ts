import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import type { AudioDataEvent, UseAudioRecorderState } from '@siteed/audio-studio';
import { optionalNative } from '../utils/nativeModules';
import audioClassifier, { AudioClassifier } from '../ml/AudioClassifier';
import { VoiceAnalyzer, CryDetector } from '../ml/VoiceAnalyzer';
import ScreamSosController from '../services/screamSosController';
import { onVoiceSosTrigger } from '../services/voiceTriggerHelper';
import { getVoiceState, pushLevel, setCryProgress, setMicState } from '../services/voiceMonitor';

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
const HOP_MS = 250;
const MODEL_EVERY_MS = 500;
/** Digital silence for this long while listening: another app or service has the microphone. */
const SILENCE_MS = 4000;
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
    const analyzer = new VoiceAnalyzer();
    const cry = new CryDetector();
    let lastModelAt = 0;
    let modelProb = 0;
    let silentSince: number | null = null;

    // WEB PLATFORM: Managed centrally via voiceTriggerHelper and onVoiceSosTrigger
    if (Platform.OS === 'web') {
      return () => {
        stopped = true;
      };
    }

    // NATIVE: @siteed/audio-studio streams 16 kHz audio every 250 ms. Each chunk gives the
    // live loudness (meter), the noise floor and whether it is a voice; a sustained loud,
    // voiced, high-pitched cry (or a loud sound the scream model calls a scream) starts the SOS.
    const onAudioStream = async (event: AudioDataEvent) => {
      if (stopped) return;
      ScreamSosController.tick(); // keeps a countdown moving while timers are paused
      const chunk = toFloat32(event.data as AudioDataEvent['data']);
      if (chunk.length === 0) return;
      const now = Date.now();

      // Slide the newest samples into the 1 s window (scream model input)
      if (chunk.length >= WINDOW) {
        ring.set(chunk.subarray(chunk.length - WINDOW));
      } else {
        ring.copyWithin(0, chunk.length);
        ring.set(chunk, WINDOW - chunk.length);
      }
      filled = Math.min(WINDOW, filled + chunk.length);

      const hop = analyzer.process(chunk);
      if (hop.silent) {
        silentSince = silentSince ?? now;
        if (now - silentSince > SILENCE_MS && getVoiceState().scream !== 'silenced') {
          setMicState('scream', 'silenced', 'Another app or the speech recogniser is using the microphone; loudness comes from speech recognition.');
        }
        return;
      }
      if (silentSince !== null || getVoiceState().scream !== 'on') setMicState('scream', 'on', null);
      silentSince = null;
      pushLevel(hop.peakDb, 'audio', { floorDb: hop.floorDb, voiced: hop.voicedRatio >= 0.3 });

      // The scream model adds evidence for rough screams; it never decides alone (it is
      // only consulted for sounds that are already at the trigger level)
      const triggerDb = getVoiceState().triggerDb;
      if (filled >= WINDOW && !busy && hop.medianDb >= triggerDb && now - lastModelAt >= MODEL_EVERY_MS) {
        busy = true;
        lastModelAt = now;
        audioClassifier.classifyWindow(ring.slice())
          .then((p) => { modelProb = audioClassifier.engine === 'tflite' ? p : 0; })
          .catch(() => { modelProb = 0; })
          .finally(() => { busy = false; });
      } else if (hop.medianDb < triggerDb) {
        modelProb = 0;
      }

      const hopMs = Math.max(HOP_MS, Math.round((chunk.length / SAMPLE_RATE) * 1000));
      const crying = cry.isCry(hop, triggerDb, modelProb, audioClassifier.threshold);
      const status = cry.push(crying, now, hopMs);
      setCryProgress(status.sustainedMs);
      onProgressRef.current?.(status.sustainedMs);
      if (status.triggered) {
        console.log(`[ScreamTrigger] sustained cry: ${hop.medianDb.toFixed(0)} dB, f0 ${hop.f0.toFixed(0)} Hz, voiced ${(hop.voicedRatio * 100).toFixed(0)}% -> SOS`);
        onScreamRef.current();
      }
    };

    let waitForForeground: { remove: () => void } | null = null;

    const start = async () => {
      try {
        if (Platform.OS !== 'web' && audioStudio) {
          setMicState('scream', 'starting');
          const perm = await audioStudio.AudioStudioModule.requestPermissionsAsync();
          if (!perm?.granted) {
            console.warn('[ScreamTrigger] Microphone permission denied; scream detection is off.');
            setMicState('scream', 'denied', 'Microphone permission is off. Allow it to use voice SOS.');
            return;
          }
          audioClassifier.load().catch(() => undefined);
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
            text: 'A loud scream or shout of about 3 seconds starts an SOS. Audio is analysed on your phone and not stored.',
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
        setMicState('scream', 'on', null);
        if (stopped) stopRecording().catch(() => undefined);
      } catch (e) {
        console.warn('[ScreamTrigger] Could not start the microphone; scream detection is off.', e);
        setMicState('scream', 'error', 'Could not start the microphone. Close other apps that record audio and try again.');
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
      setCryProgress(0);
      setMicState('scream', 'off');
      if (started) stopRecording().catch(() => undefined);
    };
  }, [enabled, background]);
}
