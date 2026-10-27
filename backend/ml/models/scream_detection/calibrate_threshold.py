"""
Picks the scream threshold for the app, using the SAME pipeline the phone runs:
latest 1 s of 16 kHz audio, zero-padded to 5 s, classified by scream_detection.tflite
every 0.5 s; an SOS starts after ~3 s of consecutive scream windows (dips up to
0.6 s, like a breath, are bridged). Mirrors app/src/ml/ScreamDurationDetector.ts.

    python backend/ml/models/scream_detection/calibrate_threshold.py \\
        --screams path/to/scream_wavs --others path/to/non_scream_wavs

Reports, per threshold:
  * missed screams  - scream recordings that would NOT start an SOS (want low)
  * false SOS       - non-scream recordings that WOULD start an SOS (want ~0)
Scream recordings shorter than ~3.5 s cannot start an SOS by design and are skipped.
Put the chosen value in AudioClassifier.MODEL_THRESHOLD (app/src/ml/AudioClassifier.ts).
"""
import argparse
from pathlib import Path

import librosa
import numpy as np

HERE = Path(__file__).resolve().parent
MODEL = HERE.parents[3] / "app" / "assets" / "models" / "scream_detection.tflite"
SR, MODEL_N, WINDOW_S, HOP_S = 16000, 80000, 1.0, 0.5
REQUIRED_S, MAX_GAP_S = 3.0, 0.6
AUDIO_EXT = {".wav", ".flac", ".ogg", ".mp3", ".m4a"}


class Model:
    def __init__(self, path):
        try:
            from ai_edge_litert.interpreter import Interpreter
        except ImportError:
            import tensorflow as tf
            Interpreter = tf.lite.Interpreter
        self.it = Interpreter(model_path=str(path))
        self.it.allocate_tensors()
        self.i = self.it.get_input_details()[0]["index"]
        self.o = self.it.get_output_details()[0]["index"]

    def __call__(self, clip):
        buf = np.zeros(MODEL_N, np.float32)
        buf[: min(len(clip), MODEL_N)] = clip[-MODEL_N:]
        self.it.set_tensor(self.i, buf[None])
        self.it.invoke()
        return float(self.it.get_tensor(self.o).reshape(-1)[0])


def window_scores(model, audio):
    w, h = int(WINDOW_S * SR), int(HOP_S * SR)
    return [model(audio[end - w:end]) for end in range(w, len(audio) + 1, h)]


def triggers(scores, threshold):
    """Python port of ScreamDurationDetector.push (first trigger only)."""
    run_start, last_pos = None, -1e9
    for k, p in enumerate(scores):
        now = (k + 1) * HOP_S
        if p >= threshold:
            if run_start is None or now - last_pos > MAX_GAP_S + HOP_S:
                run_start = now - HOP_S
            last_pos = now
        elif run_start is not None and now - last_pos > MAX_GAP_S:
            run_start = None
        if run_start is not None and last_pos - run_start >= REQUIRED_S:
            return True
    return False


def load_dir(d):
    files = sorted(p for p in Path(d).rglob("*") if p.suffix.lower() in AUDIO_EXT)
    return [(p, librosa.load(p, sr=SR, mono=True)[0]) for p in files]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--screams", help="folder of scream recordings")
    ap.add_argument("--others", help="folder of non-scream recordings")
    ap.add_argument("--model", default=str(MODEL))
    ap.add_argument("--thresholds", default="0.5,0.7,0.8,0.85,0.9,0.95,0.98")
    a = ap.parse_args()
    if not a.screams and not a.others:
        ap.error("give --screams and/or --others")
    model = Model(a.model)
    thresholds = [float(t) for t in a.thresholds.split(",")]

    sets = {}
    if a.screams:
        clips = [(p, y) for p, y in load_dir(a.screams) if len(y) >= (REQUIRED_S + 0.5) * SR]
        sets["screams"] = [window_scores(model, y) for _, y in clips]
    if a.others:
        sets["others"] = [window_scores(model, y) for _, y in load_dir(a.others)]

    print(f"{'threshold':>9} | {'missed screams':>15} | {'false SOS':>10}")
    for t in thresholds:
        miss = (f"{100 * np.mean([not triggers(s, t) for s in sets['screams']]):13.1f} %"
                if sets.get("screams") else f"{'-':>15}")
        fa = (f"{100 * np.mean([triggers(s, t) for s in sets['others']]):8.1f} %"
              if sets.get("others") else f"{'-':>10}")
        print(f"{t:9.2f} | {miss} | {fa}")
    print({k: len(v) for k, v in sets.items()}, "recordings")


if __name__ == "__main__":
    main()
