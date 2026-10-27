import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useAudioRecorder, AudioStudioModule, AudioDataEvent } from '@siteed/audio-studio';
import audioClassifier, { AudioClassifier } from '../ml/AudioClassifier';
import { ScreamDurationDetector } from '../ml/ScreamDurationDetector';

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
}

/**
 * Listens to the microphone while `enabled` and calls `onScream` once the scream model
 * has heard a scream for about 3 seconds (see ScreamDurationDetector).
 *
 * Audio is streamed in 500 ms hops at 16 kHz mono and held only in a 1 s ring buffer
 * in memory (SRS DET-8): no file is written. The microphone is released whenever
 * `enabled` turns false, so pass false while an SOS, a call or other recording runs.
 */
export function useScreamTrigger(onScream: () => void, enabled: boolean, options: ScreamTriggerOptions = {}) {
  const { startRecording, stopRecording } = useAudioRecorder();
  const onScreamRef = useRef(onScream);
  const onProgressRef = useRef(options.onProgress);
  onScreamRef.current = onScream;
  onProgressRef.current = options.onProgress;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let started = false;
    let busy = false;
    const ring = new Float32Array(WINDOW);
    let filled = 0;
    const detector = new ScreamDurationDetector();
    audioClassifier.load(); // warm the TFLite model before the first window arrives

    const onAudioStream = async (event: AudioDataEvent) => {
      if (stopped) return;
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

    (async () => {
      try {
        if (Platform.OS !== 'web') {
          const perm = await AudioStudioModule.requestPermissionsAsync();
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
        });
        started = true;
        if (stopped) stopRecording().catch(() => undefined);
      } catch (e) {
        console.warn('[ScreamTrigger] Could not start the microphone; scream detection is off.', e);
      }
    })();

    return () => {
      stopped = true;
      onProgressRef.current?.(0);
      if (started) stopRecording().catch(() => undefined);
    };
    // startRecording/stopRecording are stable for the recorder's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
