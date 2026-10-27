import { Platform } from 'react-native';
import type { TfliteModel } from 'react-native-fast-tflite';

export type AudioEngine = 'tflite' | 'heuristic';

/**
 * SRS DET-1, DET-2, DET-8: On-device scream classifier.
 *
 * Runs the trained Shield Scream CNN (backend/ml/models/scream_detection/best.pt), converted
 * to `assets/models/scream_detection.tflite` by export_tflite.py. The .tflite contains the
 * full preprocessing (log-mel spectrogram + normalisation), so it takes raw audio:
 *   input  float32 [1, 80000]  5 s of 16 kHz mono, shorter clips zero-padded at the end
 *   output float32 [1, 1]      scream probability
 *
 * For a quick reaction the app classifies the latest 1 s of audio, zero-padded to 5 s
 * exactly as the model's own preprocessing pads short clips; ScreamDurationDetector then
 * requires ~3 s of consecutive scream windows before an SOS starts.
 *
 * Where the native TFLite runtime is unavailable (web, Expo Go) a simple acoustic
 * heuristic is used instead. Audio stays in RAM and is never written to storage.
 */
export class AudioClassifier {
  public static readonly SAMPLE_RATE = 16000;
  /** Samples the model sees (5 s). */
  public static readonly MODEL_INPUT_SAMPLES = 80000;
  /** Recent audio classified per hop (1 s); padded to MODEL_INPUT_SAMPLES. */
  public static readonly SAMPLES_PER_WINDOW = 16000;
  /**
   * Model score that counts as a scream. The model was validated at 0.5, but on 800
   * everyday non-scream sounds from ESC-50 (sirens, dogs, crying babies, bells...) this
   * exact pipeline would start an SOS on 25% of 5 s clips at 0.5, 5.4% at 0.9 and 3.2%
   * at 0.95 (mostly sirens). Check missed screams on real scream recordings with
   * backend/ml/models/scream_detection/calibrate_threshold.py before changing it.
   */
  public static readonly MODEL_THRESHOLD = 0.95;
  public static readonly HEURISTIC_THRESHOLD = 0.8;

  private model: TfliteModel | null = null;
  private loading: Promise<void> | null = null;
  private readonly input = new Float32Array(AudioClassifier.MODEL_INPUT_SAMPLES);

  get engine(): AudioEngine {
    return this.model ? 'tflite' : 'heuristic';
  }

  /** Score at or above which the current engine's output counts as a scream. */
  get threshold(): number {
    return this.model ? AudioClassifier.MODEL_THRESHOLD : AudioClassifier.HEURISTIC_THRESHOLD;
  }

  /** Loads the TFLite model once; safe to call repeatedly. Never throws. */
  load(): Promise<void> {
    if (!this.loading) {
      this.loading = (async () => {
        if (Platform.OS === 'web') return;
        try {
          // Required lazily: the native module only exists in a development/production build
          const { loadTensorflowModel } = require('react-native-fast-tflite');
          this.model = await loadTensorflowModel(require('../../assets/models/scream_detection.tflite'), []);
          console.log('[AudioClassifier] Scream TFLite model loaded');
        } catch (err) {
          this.model = null;
          console.warn('[AudioClassifier] TFLite unavailable, using acoustic heuristic:', err);
        }
      })();
    }
    return this.loading;
  }

  /**
   * Scores a clip of 16 kHz mono PCM in [-1, 1] (normally the latest 1 s).
   * @returns scream probability in [0, 1]; compare against `threshold`.
   */
  async classifyWindow(pcmSamples: Float32Array): Promise<number> {
    if (!pcmSamples || pcmSamples.length === 0) return 0;
    await this.load();

    if (this.model) {
      try {
        const n = Math.min(pcmSamples.length, AudioClassifier.MODEL_INPUT_SAMPLES);
        this.input.fill(0);
        this.input.set(pcmSamples.subarray(pcmSamples.length - n)); // most recent audio, padded at the end
        const [out] = await this.model.run([this.input.buffer as ArrayBuffer]);
        const p = new Float32Array(out)[0];
        return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
      } catch (err) {
        console.warn('[AudioClassifier] TFLite inference failed, using heuristic for this window:', err);
      }
    }
    return this.computeAcousticDistressScore(pcmSamples);
  }

  /**
   * Fallback when the model cannot run. Screams tend to be loud (RMS), rough
   * (high zero-crossing rate) and dominated by 1.5-4.5 kHz energy.
   */
  private computeAcousticDistressScore(samples: Float32Array): number {
    const N = samples.length;
    let sumSquares = 0;
    let zeroCrossings = 0;

    for (let i = 0; i < N; i++) {
      const val = samples[i];
      sumSquares += val * val;
      if (i > 0 && ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0))) {
        zeroCrossings += 1;
      }
    }

    const rms = Math.sqrt(sumSquares / N);
    const zcr = zeroCrossings / N;
    if (rms < 0.02) return 0.02; // quiet background

    // First difference ~ high-pass filter
    let hfEnergy = 0;
    for (let i = 1; i < N; i++) {
      const diff = samples[i] - samples[i - 1];
      hfEnergy += diff * diff;
    }
    const hfRatio = hfEnergy / (sumSquares + 1e-6);

    let score: number;
    if (rms > 0.08 && zcr > 0.18 && hfRatio > 1.2) {
      score = 0.85 + Math.min(0.14, (rms - 0.08) * 0.5);
    } else if (rms > 0.05 && zcr > 0.12) {
      score = 0.45 + (zcr - 0.12) * 2.0;
    } else {
      score = Math.min(0.25, rms * 2.0);
    }
    return Math.max(0, Math.min(1, score));
  }
}

const audioClassifier = new AudioClassifier();
export default audioClassifier;
