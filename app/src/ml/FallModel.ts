import { Platform } from 'react-native';
import type { TfliteModel } from 'react-native-fast-tflite';
import { FALL_CHANNELS, FALL_WINDOW } from './FallDetector';

/**
 * The trained fall model, `assets/models/fall_detection.tflite`:
 *   input  float32 [1, 100, 6]  2 s at 50 Hz: ax, ay, az in m/s^2, gx, gy, gz in rad/s,
 *                               any phone orientation (trained with random rotations)
 *   output float32 [1, 1]       fall probability
 * Made by backend/ml/motion/train_fall.py (report: backend/ml/motion/reports/).
 *
 * Needs the native TFLite runtime (development or store build). Without it (Expo Go, web)
 * `available` stays false and fall detection is off; there is no rule-based fallback,
 * because the old impact-threshold rules alarmed on ordinary jumps and sit-downs.
 */
export const FALL_MODEL_THRESHOLD = 0.98; // backend/ml/motion/reports/fall_report.json "threshold" (0.981)

class FallModel {
  private model: TfliteModel | null = null;
  private loading: Promise<boolean> | null = null;

  get available() {
    return this.model !== null;
  }

  /** Loads once; resolves to whether the model can be used. Never throws. */
  load(): Promise<boolean> {
    if (!this.loading) {
      this.loading = (async () => {
        if (Platform.OS === 'web') return false;
        try {
          const { loadTensorflowModel } = require('react-native-fast-tflite');
          this.model = await loadTensorflowModel(require('../../assets/models/fall_detection.tflite'), []);
          return true;
        } catch (err) {
          console.warn('[FallModel] TFLite unavailable; fall detection is off:', err);
          this.model = null;
          return false;
        }
      })();
    }
    return this.loading;
  }

  /** Fall probability for one 2 s window (FALL_WINDOW x FALL_CHANNELS, row-major). */
  async predict(window: Float32Array): Promise<number> {
    if (!this.model || window.length !== FALL_WINDOW * FALL_CHANNELS) return 0;
    try {
      const [out] = await this.model.run([window.buffer as ArrayBuffer]);
      const p = new Float32Array(out)[0];
      return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
    } catch (err) {
      console.warn('[FallModel] inference failed', err);
      return 0;
    }
  }
}

export default new FallModel();
