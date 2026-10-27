"""
SHIELD fall detector: trains a small 1D-CNN on REAL fall recordings and exports TFLite.

Datasets (any subset; folders are found automatically under --data):
  * MobiAct v2.0  - smartphone in the trouser pocket (closest to SHIELD), accel m/s^2 + gyro rad/s
  * SisFall       - waist-worn ADXL345 + ITG3200 at 200 Hz (raw counts, converted here)

Model input matches app/src/ml/MotionClassifier.ts: float32 [1, 100, 6] = 2 s at 50 Hz of
(ax, ay, az) in m/s^2 and (gx, gy, gz) in rad/s, any phone orientation. Output: [1, 1]
fall probability. Training uses random 3-D rotations so the pocket orientation does not matter.

Honest evaluation: whole PEOPLE are held out (never seen in training). Reports window
sensitivity/specificity and, on continuous recordings, falls caught and false alarms per hour.

    python train_fall.py --data /kaggle/input/datasetfall --out /kaggle/working
"""
import argparse
import glob
import json
import os
import re
from collections import defaultdict

import numpy as np

FS = 50            # Hz the app samples at
WIN = 100          # 2 s window
G = 9.80665
RNG = np.random.default_rng(7)


# ------------------------------------------------------------------ loading

def resample(t, x, fs=FS):
    """Linear resampling of irregular samples (t in seconds) to a fixed rate."""
    if len(t) < 4:
        return np.zeros((0, x.shape[1]), np.float32)
    grid = np.arange(t[0], t[-1], 1.0 / fs)
    return np.stack([np.interp(grid, t, x[:, c]) for c in range(x.shape[1])], 1).astype(np.float32)


def load_sisfall(root):
    """-> list of (subject, kind 'fall'/'adl', code, array[n,6] at 50 Hz)."""
    out = []
    files = glob.glob(os.path.join(root, "**", "[DF][0-9][0-9]_S[AE][0-9][0-9]_R[0-9][0-9].txt"), recursive=True)
    for f in files:
        name = os.path.basename(f)
        code, subj = name.split("_")[0], "sis_" + name.split("_")[1]
        rows = []
        with open(f, errors="ignore") as fh:
            for line in fh:
                line = line.strip().rstrip(";")
                if line:
                    try:
                        rows.append([int(v) for v in line.split(",")[:6]])
                    except ValueError:
                        pass
        if len(rows) < 400:
            continue
        a = np.asarray(rows, np.float32)
        acc = a[:, 0:3] * (32.0 / 8192.0) * G            # ADXL345 +-16 g, 13 bit -> m/s^2
        gyr = a[:, 3:6] * (4000.0 / 65536.0) * np.pi / 180  # ITG3200 +-2000 deg/s, 16 bit -> rad/s
        x = np.concatenate([acc, gyr], 1)
        x = x[: len(x) // 4 * 4].reshape(-1, 4, 6).mean(1)   # 200 Hz -> 50 Hz
        out.append((subj, "fall" if code[0] == "F" else "adl", code, x))
    return out


MOBI_FALLS = {"FOL", "FKL", "BSC", "SDL"}


def load_mobiact(root):
    """MobiAct v2.0 'Annotated Data' CSVs (timestamp,rel_time,acc_x..z,gyro_x..z,azimuth,pitch,roll,label)."""
    out = []
    for f in glob.glob(os.path.join(root, "**", "*_annotated.csv"), recursive=True):
        m = re.match(r"([A-Z]{3})_(\d+)_(\d+)_annotated\.csv", os.path.basename(f))
        if not m:
            continue
        code, subj = m.group(1), "mobi_" + m.group(2)
        try:
            d = np.genfromtxt(f, delimiter=",", names=True, dtype=None, encoding=None)
        except Exception:
            continue
        cols = d.dtype.names
        need = ["rel_time", "acc_x", "acc_y", "acc_z", "gyro_x", "gyro_y", "gyro_z"]
        if not all(c in cols for c in need):
            continue
        t = np.asarray(d["rel_time"], float)
        if t.max() > 1e6:          # nanoseconds
            t = t / 1e9
        x = np.stack([np.asarray(d[c], float) for c in need[1:]], 1)
        order = np.argsort(t)
        x = resample(t[order], x[order])
        if len(x) >= WIN:
            out.append((subj, "fall" if code in MOBI_FALLS else "adl", code, x))
    return out


# ------------------------------------------------------------------ windows

def magnitude(x):
    return np.linalg.norm(x[:, :3], axis=1)


def make_windows(recs, train):
    """Fall recordings: windows around the impact (largest acceleration peak) are positive,
    the calm part before the fall is negative. ADL recordings: sliding windows, all negative."""
    X, y = [], []
    for subj, kind, code, x in recs:
        if kind == "fall":
            p = int(np.argmax(magnitude(x)))
            offsets = (30, 40, 50, 60, 70) if train else (50,)
            for off in offsets:   # impact somewhere in the window, like a live stream sees it
                s = p - off
                if 0 <= s and s + WIN <= len(x):
                    X.append(x[s:s + WIN]); y.append(1)
            for s in range(0, max(0, p - 2 * WIN), WIN):   # before the fall: ordinary movement
                X.append(x[s:s + WIN]); y.append(0)
        else:
            stride = WIN // 2 if train else WIN
            for s in range(0, len(x) - WIN + 1, stride):
                X.append(x[s:s + WIN]); y.append(0)
    return np.asarray(X, np.float32), np.asarray(y, np.float32)


def random_rotation():
    q = RNG.normal(size=4)
    q /= np.linalg.norm(q)
    a, b, c, d = q
    return np.array([[a*a+b*b-c*c-d*d, 2*(b*c-a*d), 2*(b*d+a*c)],
                     [2*(b*c+a*d), a*a-b*b+c*c-d*d, 2*(c*d-a*b)],
                     [2*(b*d-a*c), 2*(c*d+a*b), a*a-b*b-c*c+d*d]], np.float32)


def augment(X):
    """Random phone orientation (same rotation for accel and gyro), gain and noise."""
    out = np.empty_like(X)
    for i, w in enumerate(X):
        R = random_rotation()
        acc, gyr = w[:, :3] @ R.T, w[:, 3:] @ R.T
        acc *= RNG.uniform(0.9, 1.1)
        out[i] = np.concatenate([acc, gyr], 1) + RNG.normal(0, 0.05, w.shape)
    return out


# ------------------------------------------------------------------ model

def build_model():
    import tensorflow as tf
    class Features(tf.keras.layers.Layer):
        """Scales raw units and adds orientation-free |acc| and |gyro| channels, which look the
        same however the phone sits in a pocket."""
        def call(self, w):
            acc, gyr = w[:, :, :3], w[:, :, 3:]
            mag_a = tf.sqrt(tf.reduce_sum(tf.square(acc), -1, keepdims=True) + 1e-6)
            mag_g = tf.sqrt(tf.reduce_sum(tf.square(gyr), -1, keepdims=True) + 1e-6)
            return tf.concat([acc / (2 * G), gyr / 4.0, mag_a / (2 * G), mag_g / 4.0], -1)

    inp = tf.keras.Input((WIN, 6), name="motion")
    x = Features()(inp)
    for f in (32, 64, 64):
        x = tf.keras.layers.Conv1D(f, 5, padding="same", activation="relu")(x)
        x = tf.keras.layers.MaxPooling1D(2)(x)
    x = tf.keras.layers.Concatenate()([tf.keras.layers.GlobalAveragePooling1D()(x), tf.keras.layers.GlobalMaxPooling1D()(x)])
    x = tf.keras.layers.Dropout(0.3)(x)
    x = tf.keras.layers.Dense(32, activation="relu")(x)
    out = tf.keras.layers.Dense(1, activation="sigmoid", name="fall_probability")(x)
    m = tf.keras.Model(inp, out)
    m.compile(optimizer=tf.keras.optimizers.Adam(1e-3), loss="binary_crossentropy",
              metrics=[tf.keras.metrics.AUC(name="auc")])
    return m


def stream_eval(model, recs, threshold, hop=25):
    """Live-stream simulation: a window every 0.5 s over every whole recording."""
    caught = falls = alarms = 0
    adl_seconds = 0.0
    for _, kind, _, x in recs:
        if len(x) < WIN:
            continue
        starts = np.arange(0, len(x) - WIN + 1, hop)
        probs = model.predict(np.stack([x[s:s + WIN] for s in starts]), verbose=0)[:, 0]
        hit = probs >= threshold
        if kind == "fall":
            falls += 1
            p = int(np.argmax(magnitude(x)))
            near = (starts + WIN > p - 25) & (starts < p + 50)
            caught += bool(hit[near].any())
            # alarms well before the fall count as false alarms too
            alarms += int(np.sum(hit & (starts + WIN < p - 2 * FS)) > 0)
            adl_seconds += max(0, p - 2 * FS) / FS
        else:
            adl_seconds += len(x) / FS
            # count separate alarm episodes (an SOS countdown would start once per episode)
            alarms += int(np.sum(np.diff(np.concatenate([[0], hit.astype(int)])) == 1))
    return {"falls": falls, "falls_caught": caught, "sensitivity": caught / max(1, falls),
            "false_alarms": alarms, "adl_hours": adl_seconds / 3600,
            "false_alarms_per_hour": alarms / max(1e-9, adl_seconds / 3600)}


# ------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", default=".")
    ap.add_argument("--epochs", type=int, default=40)
    a = ap.parse_args()
    import tensorflow as tf
    tf.random.set_seed(7)

    recs = load_mobiact(a.data) + load_sisfall(a.data)
    by_set = defaultdict(lambda: [0, 0])
    for s, k, _, _ in recs:
        by_set[s.split("_")[0]][k == "fall"] += 1
    print("recordings (adl, fall):", dict(by_set))
    subjects = sorted({r[0] for r in recs})
    RNG.shuffle(subjects)
    n = len(subjects)
    n_test, n_val = max(2, n // 5), max(2, n // 6)
    test_s = set(subjects[:n_test])
    val_s = set(subjects[n_test:n_test + n_val])
    train_r = [r for r in recs if r[0] not in test_s | val_s]
    val_r = [r for r in recs if r[0] in val_s]
    test_r = [r for r in recs if r[0] in test_s]
    print(f"people: train {n - len(test_s) - len(val_s)}, val {len(val_s)}, test {len(test_s)} (never seen)")

    Xtr, ytr = make_windows(train_r, True)
    Xva, yva = make_windows(val_r, False)
    Xte, yte = make_windows(test_r, False)
    print("windows train/val/test:", len(ytr), len(yva), len(yte), "falls in train:", int(ytr.sum()))

    model = build_model()
    pos = ytr.mean()
    cw = {0: 0.5 / (1 - pos), 1: 0.5 / pos}
    best, wait, best_w = -1, 0, None
    for ep in range(a.epochs):
        model.fit(augment(Xtr), ytr, batch_size=128, epochs=1, class_weight=cw, verbose=0)
        auc = float(tf.keras.metrics.AUC()(yva, model.predict(Xva, verbose=0)[:, 0]))
        print(f"epoch {ep + 1:02d}  val AUC {auc:.4f}")
        if auc > best:
            best, wait, best_w = auc, 0, model.get_weights()
        else:
            wait += 1
            if wait >= 8:
                break
    model.set_weights(best_w)

    # Threshold: highest one that still catches >= 95% of validation falls (fewest false alarms)
    pv = model.predict(Xva, verbose=0)[:, 0]
    fall_scores = np.sort(pv[yva == 1])
    threshold = float(fall_scores[int(0.05 * len(fall_scores))]) if len(fall_scores) else 0.5
    threshold = min(max(threshold, 0.5), 0.99)

    pt = model.predict(Xte, verbose=0)[:, 0]
    sens = float(((pt >= threshold) & (yte == 1)).sum() / max(1, (yte == 1).sum()))
    spec = float(((pt < threshold) & (yte == 0)).sum() / max(1, (yte == 0).sum()))
    test_auc = float(tf.keras.metrics.AUC()(yte, pt))
    stream = stream_eval(model, test_r, threshold)
    report = {"threshold": threshold, "test_window_auc": test_auc, "test_window_sensitivity": sens,
              "test_window_specificity": spec, "test_stream": stream,
              "test_people": sorted(test_s), "recordings": dict(by_set)}
    print(json.dumps(report, indent=2))

    os.makedirs(a.out, exist_ok=True)
    model.export(os.path.join(a.out, "fall_savedmodel"))
    conv = tf.lite.TFLiteConverter.from_saved_model(os.path.join(a.out, "fall_savedmodel"))
    conv.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS]
    tfl = conv.convert()
    with open(os.path.join(a.out, "fall_detection.tflite"), "wb") as fh:
        fh.write(tfl)
    # Parity: TFLite must match Keras on test windows
    it = tf.lite.Interpreter(model_content=tfl)
    it.allocate_tensors()
    i, o = it.get_input_details()[0]["index"], it.get_output_details()[0]["index"]
    diffs = []
    for w, ref in zip(Xte[:200], pt[:200]):
        it.set_tensor(i, w[None]); it.invoke()
        diffs.append(abs(float(it.get_tensor(o)[0, 0]) - float(ref)))
    report["tflite_max_diff"] = float(max(diffs))
    report["tflite_kb"] = round(len(tfl) / 1024)
    with open(os.path.join(a.out, "fall_report.json"), "w") as fh:
        json.dump(report, fh, indent=2)
    print("TFLite", report["tflite_kb"], "KB, max diff vs Keras", report["tflite_max_diff"])


if __name__ == "__main__":
    main()
