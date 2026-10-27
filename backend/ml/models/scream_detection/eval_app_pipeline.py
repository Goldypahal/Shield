"""
Evaluates the scream model exactly as the app runs it (useScreamTrigger + ScreamDurationDetector):
the latest 1 s of 16 kHz audio, zero-padded to the model's 5 s, scored every 0.5 s; an SOS
starts after ~3 s of scores >= 0.95 (gaps up to 600 ms allowed), then a 20 s cooldown.

    python eval_app_pipeline.py --scream DIR [--other DIR ...] [--esc50 DIR]

--scream: folders of real scream recordings (any length): reports how many start an SOS.
--other / --esc50: everyday sounds: reports false SOS per clip and per hour of audio,
   the latter on one continuous stream made by joining every clip.
"""
import argparse, glob, os
import numpy as np, librosa, tensorflow as tf

SR, WIN, HOP, MODEL_N = 16000, 16000, 8000, 80000
THRESH, REQUIRED_MS, GAP_MS, COOLDOWN_MS = 0.95, 3000, 600, 20000
HOP_MS = HOP * 1000 // SR

here = os.path.dirname(os.path.abspath(__file__))
default_model = os.path.join(here, '..', '..', '..', '..', 'app', 'assets', 'models', 'scream_detection.tflite')


class Detector:  # port of app/src/ml/ScreamDurationDetector.ts
    def __init__(self):
        self.run_start = None; self.last_pos = 0; self.cool = 0

    def push(self, p, now):
        if now < self.cool:
            self.run_start = None; return False
        if p >= THRESH:
            if self.run_start is None or now - self.last_pos > GAP_MS + HOP_MS:
                self.run_start = now - HOP_MS
            self.last_pos = now
        elif self.run_start is not None and now - self.last_pos > GAP_MS:
            self.run_start = None
        if self.run_start is not None and self.last_pos - self.run_start >= REQUIRED_MS:
            self.run_start = None; self.cool = now + COOLDOWN_MS
            return True
        return False


def scorer(model):
    it = tf.lite.Interpreter(model_path=model); it.allocate_tensors()
    i, o = it.get_input_details()[0]['index'], it.get_output_details()[0]['index']
    buf = np.zeros((1, MODEL_N), np.float32)

    def p(w):
        buf[:] = 0; buf[0, :len(w)] = w
        it.set_tensor(i, buf); it.invoke()
        return float(it.get_tensor(o)[0, 0])
    return p


def stream(p, y):
    """Runs the app pipeline over audio y; returns (sos times in s, fraction of windows >= threshold)."""
    d, hits, pos, n = Detector(), [], 0, 0
    for end in range(WIN, len(y) + 1, HOP):
        s = p(y[end - WIN:end]); n += 1; pos += s >= THRESH
        if d.push(s, end * 1000 // SR):
            hits.append(end / SR)
    return hits, (pos / n if n else 0.0)


def files(dirs):
    out = []
    for d in dirs:
        for ext in ('wav', 'mp3', 'ogg', 'flac', 'm4a'):
            out += glob.glob(os.path.join(d, '**', f'*.{ext}'), recursive=True)
    return sorted(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default=default_model)
    ap.add_argument('--scream', nargs='*', default=[])
    ap.add_argument('--other', nargs='*', default=[])
    ap.add_argument('--esc50', default=None)
    ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    p = scorer(a.model)
    report = {}

    sc = files(a.scream)[: a.limit or None]
    if sc:
        caught, short, fr = 0, 0, []
        for f in sc:
            y, _ = librosa.load(f, sr=SR, mono=True)
            if len(y) < 3.5 * SR:  # too short to hold a 3 s scream: loop it, like a longer scream
                short += 1; y = np.tile(y, int(np.ceil(4 * SR / max(1, len(y)))))
            hits, frac = stream(p, y)
            caught += bool(hits); fr.append(frac)
        report['screams'] = dict(files=len(sc), started_sos=caught, recall=round(caught / len(sc), 3),
                                 looped_short_clips=short, mean_scream_window_fraction=round(float(np.mean(fr)), 3))

    neg = files(a.other)
    if a.esc50:
        neg += sorted(glob.glob(os.path.join(a.esc50, 'audio', '*.wav')))
    neg = neg[: a.limit or None]
    if neg:
        clips_with_sos, joined, per_class = 0, [], {}
        for f in neg:
            y, _ = librosa.load(f, sr=SR, mono=True)
            hits, _ = stream(p, y)
            clips_with_sos += bool(hits); joined.append(y)
            if hits and a.esc50 and '/esc50/' in f.replace('\\', '/') + '/':
                pass
            if hits:
                per_class[os.path.basename(f)] = len(hits)
        y = np.concatenate(joined)
        hits, _ = stream(p, y)
        hours = len(y) / SR / 3600
        report['everyday_sounds'] = dict(clips=len(neg), clips_starting_sos=clips_with_sos,
                                         false_sos_rate_per_clip=round(clips_with_sos / len(neg), 4),
                                         stream_hours=round(hours, 2), false_sos_in_stream=len(hits),
                                         false_sos_per_hour=round(len(hits) / hours, 2),
                                         examples=sorted(per_class)[:15])
    import json
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()


# ---------------------------------------------------------------- tuning grid
def grid(model, scream_files, other_files, windows=(1.0, 2.0), thresholds=(0.9, 0.95, 0.98, 0.99),
         required=(2000, 3000)):
    """Recall on screams vs false SOS per hour on everyday sounds, for each app setting."""
    p = scorer(model)

    def seqs(fs, loop_short):
        out = {w: [] for w in windows}
        secs = 0.0
        for f in fs:
            y, _ = librosa.load(f, sr=SR, mono=True)
            if loop_short and len(y) < 3.5 * SR:
                y = np.tile(y, int(np.ceil(4 * SR / max(1, len(y)))))
            secs += len(y) / SR
            for w in windows:
                n = int(w * SR)
                out[w].append([p(y[e - n:e]) for e in range(n, len(y) + 1, HOP)])
        return out, secs

    def run(seq, t, req):
        global THRESH, REQUIRED_MS
        THRESH, REQUIRED_MS = t, req
        d, hits = Detector(), 0
        for k, s in enumerate(seq):
            hits += d.push(s, (k + 1) * HOP_MS)
        return hits

    S, _ = seqs(scream_files, True)
    N, nsecs = seqs(other_files, False)
    rows = []
    for w in windows:
        joined = [s for q in N[w] for s in q]
        for t in thresholds:
            for req in required:
                rec = np.mean([run(q, t, req) > 0 for q in S[w]]) if S[w] else float('nan')
                fph = run(joined, t, req) / (nsecs / 3600) if joined else float('nan')
                rows.append(dict(window_s=w, threshold=t, required_ms=req, recall=round(float(rec), 3),
                                 false_sos_per_hour=round(float(fph), 2)))
    return rows
