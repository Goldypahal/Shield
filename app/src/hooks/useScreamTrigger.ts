import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import type { AudioDataEvent, UseAudioRecorderState } from '@siteed/audio-studio';
import { optionalNative } from '../utils/nativeModules';
import audioClassifier, { AudioClassifier } from '../ml/AudioClassifier';
import { ScreamDurationDetector } from '../ml/ScreamDurationDetector';
import ScreamSosController from '../services/screamSosController';
import { onVoiceSosTrigger, getVoiceSupportInfo } from '../services/voiceTriggerHelper';

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

const EMERGENCY_KEYWORDS = [
  'help',
  'help me',
  'emergency',
  'scream',
  'bachao',
  'save me',
  'sos',
  'danger',
  'police',
];

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
  onProgressRef.current = options.onProgress;

  // Listen for synthetic or test triggers
  useEffect(() => {
    if (!enabled) return;
    const unsub = onVoiceSosTrigger(() => {
      console.log('[ScreamTrigger] Voice SOS triggered via event!');
      onScreamRef.current();
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

    // WEB PLATFORM IMPLEMENTATION
    if (Platform.OS === 'web') {
      const support = getVoiceSupportInfo();
      console.log('[ScreamTrigger Web]', support.summary);

      let speechRec: any = null;
      let webAudioContext: any = null;
      let mediaStream: any = null;

      // 1. Web Speech Recognition for Voice Keywords ("Help", "Emergency", "SOS")
      if (typeof window !== 'undefined') {
        const SpeechRecClass =
          (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecClass) {
          try {
            speechRec = new SpeechRecClass();
            speechRec.continuous = true;
            speechRec.interimResults = true;
            speechRec.lang = 'en-US';

            speechRec.onresult = (event: any) => {
              if (stopped) return;
              for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcript = String(event.results[i][0]?.transcript || '').toLowerCase().trim();
                console.log('[SpeechRecognition] Heard:', transcript);
                const matched = EMERGENCY_KEYWORDS.some((kw) => transcript.includes(kw));
                if (matched) {
                  console.log('[SpeechRecognition] Emergency keyword matched! Triggering SOS.');
                  onScreamRef.current();
                  break;
                }
              }
            };

            speechRec.onerror = (err: any) => {
              if (err.error !== 'no-speech') {
                console.warn('[SpeechRecognition] Warning:', err.error);
              }
            };

            speechRec.onend = () => {
              if (!stopped && enabled) {
                try {
                  speechRec.start();
                } catch (_) {}
              }
            };

            speechRec.start();
            console.log('[ScreamTrigger] Web Speech Recognition active for keywords (Help me, Emergency, SOS)');
          } catch (e) {
            console.warn('[SpeechRecognition] Could not start speech recognition:', e);
          }
        }
      }

      // 2. Web Audio Acoustic Level / Scream fallback (if navigator.mediaDevices is permitted)
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => {
            if (stopped) {
              stream.getTracks().forEach((t) => t.stop());
              return;
            }
            mediaStream = stream;
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtx) return;
            webAudioContext = new AudioCtx();
            const source = webAudioContext.createMediaStreamSource(stream);
            const analyser = webAudioContext.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);

            const buffer = new Float32Array(analyser.frequencyBinCount);
            let screamCount = 0;

            const checkAudio = () => {
              if (stopped) return;
              analyser.getFloatTimeDomainData(buffer);
              let sum = 0;
              for (let i = 0; i < buffer.length; i++) {
                sum += buffer[i] * buffer[i];
              }
              const rms = Math.sqrt(sum / buffer.length);
              
              // If volume exceeds loud distress threshold (~ -15 dB)
              if (rms > 0.12) {
                screamCount += 1;
                onProgressRef.current?.(screamCount * 250);
                if (screamCount >= 5) { // ~1.25s of sustained shouting/screaming
                  console.log('[WebAudio] Loud distress sound detected! Triggering SOS.');
                  screamCount = 0;
                  onScreamRef.current();
                }
              } else {
                screamCount = Math.max(0, screamCount - 1);
                onProgressRef.current?.(screamCount * 250);
              }

              requestAnimationFrame(checkAudio);
            };

            requestAnimationFrame(checkAudio);
          })
          .catch((err) => {
            console.warn('[WebAudio] MediaDevices access not granted or unavailable:', err?.message || err);
          });
      }

      return () => {
        stopped = true;
        if (speechRec) {
          try {
            speechRec.abort();
          } catch (_) {}
        }
        if (mediaStream) {
          try {
            mediaStream.getTracks().forEach((t: any) => t.stop());
          } catch (_) {}
        }
        if (webAudioContext && webAudioContext.state !== 'closed') {
          try {
            webAudioContext.close();
          } catch (_) {}
        }
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
  }, [enabled, background]);
}
