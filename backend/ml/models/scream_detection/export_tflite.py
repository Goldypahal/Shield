"""
Converts the Shield scream CNN (best.pt) to an on-device TFLite model.

The .tflite takes RAW audio and does the whole `inference.py` preprocessing itself, so
the app only has to hand over samples:

    input   float32 [1, 80000]   5 s of 16 kHz mono PCM in [-1, 1]
                                  (shorter clips: zero-pad at the END, like inference.py)
    output  float32 [1, 1]       sigmoid scream probability (threshold 0.5)

Graph = librosa.feature.melspectrogram (n_fft 1024, hop 256, 64 mels, 40-8000 Hz,
centered with zero padding, Hann, power 2, Slaney mel) -> power_to_db(ref=max, top_db=80)
-> per-clip standardisation -> ScreamCNN with the PyTorch weights. Builtin TFLite ops only
(no Flex delegate needed on the phone).

Usage (from the repo root):
    pip install torch tensorflow-cpu librosa soundfile
    python backend/ml/models/scream_detection/export_tflite.py
Then check parity:
    python backend/ml/models/scream_detection/export_tflite.py --verify-only
"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
DEFAULT_OUT = REPO / "app" / "assets" / "models" / "scream_detection.tflite"


def load_config():
    return json.loads((HERE / "config.json").read_text())


def build_tf_function(cfg, state):
    """Pure TF graph with constant weights (BatchNorm folded into each conv), so the
    .tflite has no variables and runs on any TFLite runtime."""
    import librosa
    import tensorflow as tf

    sr = int(cfg["sample_rate"])
    n_samples = sr * int(cfg["duration_seconds"])
    n_fft, hop, n_mels = int(cfg["n_fft"]), int(cfg["hop_length"]), int(cfg["n_mels"])

    mel_basis = librosa.filters.mel(sr=sr, n_fft=n_fft, n_mels=n_mels,
                                    fmin=float(cfg["fmin"]), fmax=float(cfg["fmax"]))  # [64, 513]
    mel_basis_t = tf.constant(mel_basis.T.astype(np.float32))  # [513, 64]
    window = tf.constant(np.hanning(n_fft + 1)[:-1].astype(np.float32))  # periodic Hann, as librosa

    convs = []
    for conv_i, bn_i in ((0, 1), (4, 5), (8, 9), (12, 13)):
        w = state[f"features.{conv_i}.weight"].numpy().astype(np.float64)  # [out, in, kh, kw]
        b = state[f"features.{conv_i}.bias"].numpy().astype(np.float64)
        g, beta, mu, var = (state[f"features.{bn_i}.{k}"].numpy().astype(np.float64)
                            for k in ("weight", "bias", "running_mean", "running_var"))
        scale = g / np.sqrt(var + 1e-5)
        w_f = (w * scale[:, None, None, None]).transpose(2, 3, 1, 0)  # HWIO
        b_f = (b - mu) * scale + beta
        convs.append((tf.constant(w_f.astype(np.float32)), tf.constant(b_f.astype(np.float32))))
    head_w = tf.constant(state["head.2.weight"].numpy().T.astype(np.float32))  # [128, 1]
    head_b = tf.constant(state["head.2.bias"].numpy().astype(np.float32))

    @tf.function(input_signature=[tf.TensorSpec([1, n_samples], tf.float32, name="audio")])
    def serve(wav):
        pad = n_fft // 2
        wav = tf.pad(wav, [[0, 0], [pad, pad]])  # center=True, pad_mode='constant'
        frames = tf.signal.frame(wav, n_fft, hop) * window  # [1, T, 1024]
        spec = tf.signal.rfft(frames)
        power = tf.square(tf.math.real(spec)) + tf.square(tf.math.imag(spec))  # [1, T, 513]
        mel = tf.matmul(power, mel_basis_t)  # [1, T, 64]
        log_spec = 10.0 * tf.math.log(tf.maximum(mel, 1e-10)) / np.log(10.0).astype(np.float32)
        ref = tf.reduce_max(log_spec, axis=[1, 2], keepdims=True)  # ref=np.max
        db = tf.maximum(log_spec - ref, -80.0)  # top_db = 80
        mean = tf.reduce_mean(db, axis=[1, 2], keepdims=True)
        std = tf.sqrt(tf.reduce_mean(tf.square(db - mean), axis=[1, 2], keepdims=True))
        x = (db - mean) / (std + 1e-6)
        # PyTorch sees [B, 1, mels, T]; NHWC equivalent is [B, mels, T, 1]
        x = tf.expand_dims(tf.transpose(x, [0, 2, 1]), -1)
        for w, b in convs:
            x = tf.nn.relu(tf.nn.conv2d(x, w, 1, "SAME") + b)
            x = tf.nn.max_pool2d(x, 2, 2, "VALID")  # floor, like nn.MaxPool2d(2)
        x = tf.reduce_mean(x, axis=[1, 2])  # AdaptiveAvgPool2d((1, 1))
        return {"scream_probability": tf.sigmoid(tf.matmul(x, head_w) + head_b)}

    return serve


def export(out_path: Path):
    import tensorflow as tf
    import torch

    cfg = load_config()
    ckpt = torch.load(HERE / "best.pt", map_location="cpu", weights_only=False)
    serve = build_tf_function(cfg, ckpt["model"])
    converter = tf.lite.TFLiteConverter.from_concrete_functions([serve.get_concrete_function()])
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS]  # no Flex ops on device
    tflite = converter.convert()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(tflite)
    print(f"Wrote {out_path} ({len(tflite) / 1024:.0f} KiB)")


def verify(out_path: Path):
    """Compares the .tflite against the original PyTorch model + librosa preprocessing."""
    import io
    import soundfile as sf
    import tensorflow as tf

    sys.path.insert(0, str(HERE))
    from inference import ScreamPredictor  # the reference implementation

    ref = ScreamPredictor(HERE)
    interp = tf.lite.Interpreter(model_path=str(out_path))
    interp.allocate_tensors()
    i_det, o_det = interp.get_input_details()[0], interp.get_output_details()[0]
    sr, n = ref.sample_rate, ref.n_samples
    rng = np.random.default_rng(7)
    t = np.arange(n) / sr

    def tone(f, amp):
        return amp * np.sin(2 * np.pi * f * t)

    clips = {
        "silence-ish noise": 0.003 * rng.standard_normal(n),
        "white noise": 0.3 * rng.standard_normal(n),
        "low hum 120 Hz": tone(120, 0.4),
        "speech-like 180 Hz + harmonics": tone(180, 0.2) + tone(360, 0.1) + tone(540, 0.05),
        "harsh 2.6+3.4 kHz + noise": tone(2600, 0.35) + tone(3400, 0.25) + 0.15 * rng.standard_normal(n),
        "chirp 800-3000 Hz": 0.5 * np.sin(2 * np.pi * (800 * t + 220 * t ** 2)),
        "1 s burst then zero-pad": np.concatenate([tone(2600, 0.4)[:sr] + 0.1 * rng.standard_normal(sr), np.zeros(n - sr)]),
        "clipped square 1 kHz": np.clip(5 * tone(1000, 1.0), -0.9, 0.9),
    }
    max_diff = 0.0
    timings = []
    print(f"{'clip':34s} {'pytorch':>9s} {'tflite':>9s} {'|diff|':>9s}")
    for name, audio in clips.items():
        audio = audio.astype(np.float32)
        buf = io.BytesIO()
        sf.write(buf, audio, sr, format="WAV", subtype="FLOAT")
        p_ref = ref.predict_bytes(buf.getvalue())["probability"]
        interp.set_tensor(i_det["index"], audio[None, :])
        t0 = time.perf_counter()
        interp.invoke()
        timings.append(time.perf_counter() - t0)
        p_tfl = float(interp.get_tensor(o_det["index"]).reshape(-1)[0])
        d = abs(p_ref - p_tfl) if np.isfinite(p_tfl) else float("inf")
        max_diff = max(max_diff, d)
        print(f"{name:34s} {p_ref:9.5f} {p_tfl:9.5f} {d:9.2e}")
    print(f"max |diff| = {max_diff:.2e}; median CPU time {1000 * np.median(timings):.1f} ms per 5 s clip")
    if max_diff > 1e-3:
        raise SystemExit("TFLite output does not match PyTorch closely enough.")
    print("Parity OK")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--verify-only", action="store_true")
    args = ap.parse_args()
    if not args.verify_only:
        export(args.out)
    verify(args.out)
