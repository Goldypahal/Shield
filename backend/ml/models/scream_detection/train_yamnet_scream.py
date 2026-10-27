"""
SHIELD scream detector v2: Google's YAMNet (AudioSet-pretrained, on-device) + a small head
trained to tell screams from everything else, exported as ONE TFLite file for the app.

Why: the first scream CNN, run the way the app runs it, caught only ~23% of real scream
clips (public AudioSet-based "Human Screaming Detection" set) at ~10 false SOS per hour
(clip AUC 0.857). YAMNet's own "Screaming" class already reaches AUC 0.957 there.

Model for the app (scream_detection.tflite):
    input  float32 [15600]   0.975 s of 16 kHz mono audio in [-1, 1]
    output float32 [1, 1]    scream probability
The app scores the latest 0.975 s every 0.5 s and starts an SOS after ~3 s of screaming.

Data (Kaggle):
    whats2000/human-screaming-detection-dataset   Screaming / NotScreaming (10 s YouTube clips)
    goldypahal/audio1 -> ESC-50                   2000 everyday sounds, hard negatives
                                                  (crying baby, siren, birds, ...)
Split: whats2000 by file 70/15/15, ESC-50 by fold (1-3 train, 4 val, 5 test).
Clip labels are weak (a 10 s "screaming" clip has quiet parts), so for scream clips only the
frames YAMNet itself finds most scream/shout-like are used as positives.

    python train_yamnet_scream.py --out /kaggle/working
"""
import argparse, csv, glob, hashlib, json, os, random

import numpy as np

SR = 16000
FRAME = 15600          # YAMNet's 0.975 s patch
HOP_S = 0.5            # app scores every 0.5 s
random.seed(7); np.random.seed(7)


def split_of(path, fold=None):
    if fold is not None:
        return 'train' if fold <= 3 else ('val' if fold == 4 else 'test')
    h = int(hashlib.md5(os.path.basename(path).encode()).hexdigest(), 16) % 100
    return 'train' if h < 70 else ('val' if h < 85 else 'test')


def collect():
    import kagglehub
    hs = kagglehub.dataset_download('whats2000/human-screaming-detection-dataset')
    a1 = kagglehub.dataset_download('goldypahal/audio1')
    items = []  # (path, label, split, source)
    for f in glob.glob(os.path.join(hs, '**', '*.wav'), recursive=True):
        parts = f.lower().replace('\\', '/').split('/')
        lab = 0 if any('notscream' in p for p in parts) else (1 if any('scream' in p for p in parts) else None)
        if lab is not None:
            items.append((f, lab, split_of(f), 'hsd'))
    meta = glob.glob(os.path.join(a1, '**', 'esc50.csv'), recursive=True)
    if meta:
        root = os.path.dirname(os.path.dirname(meta[0]))
        for r in csv.DictReader(open(meta[0])):
            f = os.path.join(root, 'audio', r['filename'])
            if os.path.exists(f):
                items.append((f, 0, split_of(f, int(r['fold'])), 'esc50:' + r['category']))
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='.')
    ap.add_argument('--epochs', type=int, default=40)
    a = ap.parse_args()
    import librosa, tensorflow as tf, kagglehub
    from sklearn.metrics import roc_auc_score

    ym = kagglehub.model_download('google/yamnet/tensorFlow2/yamnet')
    Y = tf.saved_model.load(ym)
    names = [r['display_name'] for r in csv.DictReader(open(os.path.join(ym, 'assets', 'yamnet_class_map.csv')))]
    scream_like = [names.index(n) for n in ('Screaming', 'Shout', 'Yell', 'Children shouting', 'Battle cry') if n in names]

    items = collect()
    print('clips:', {s: sum(1 for i in items if i[2] == s) for s in ('train', 'val', 'test')},
          'screams:', sum(i[1] for i in items))

    # --- YAMNet embeddings per 0.975 s frame (YAMNet hops 0.48 s internally)
    feats = {}
    for k, (f, lab, sp, src) in enumerate(items):
        y, _ = librosa.load(f, sr=SR, mono=True)
        if len(y) < FRAME:
            y = np.pad(y, (0, FRAME - len(y)))
        sc, emb, _ = Y(y.astype(np.float32))
        feats[f] = (emb.numpy(), sc.numpy()[:, scream_like].max(axis=1))
        if k % 500 == 0:
            print('embedded', k, '/', len(items))

    def frames(split):
        X, L = [], []
        for f, lab, sp, src in items:
            if sp != split:
                continue
            emb, sl = feats[f]
            if lab == 1:
                keep = sl >= max(np.quantile(sl, 0.6), 0.02)   # scream-like frames only (weak labels)
                X.append(emb[keep]); L.append(np.ones(int(keep.sum())))
            else:
                X.append(emb); L.append(np.zeros(len(emb)))
        return np.concatenate(X).astype(np.float32), np.concatenate(L).astype(np.float32)

    Xtr, ytr = frames('train'); Xva, yva = frames('val')
    print('frames train', Xtr.shape, 'pos', int(ytr.sum()), '| val', Xva.shape, 'pos', int(yva.sum()))

    head = tf.keras.Sequential([
        tf.keras.Input((1024,)),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(128, activation='relu'),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(1, activation='sigmoid'),
    ])
    head.compile(optimizer=tf.keras.optimizers.Adam(1e-3), loss='binary_crossentropy', metrics=[tf.keras.metrics.AUC(name='auc')])
    pos = ytr.mean()
    head.fit(Xtr, ytr, validation_data=(Xva, yva), epochs=a.epochs, batch_size=256, verbose=2,
             class_weight={0: 0.5 / (1 - pos), 1: 0.5 / pos},
             callbacks=[tf.keras.callbacks.EarlyStopping('val_auc', mode='max', patience=6, restore_best_weights=True)])

    # --- Evaluate exactly like the app: 0.975 s windows every 0.5 s, sustained-scream rule
    def window_scores(f):
        # YAMNet's own frames: 0.96 s every 0.48 s, practically the app's 0.975 s every 0.5 s
        return head.predict(feats[f][0], verbose=0)[:, 0]

    def sos_count(seq, t, req_s, gap_s=0.6):
        hits, run_start, last, cool = 0, None, -99.0, -1.0
        for k, s in enumerate(seq):
            now = (k + 1) * HOP_S
            if now < cool:
                run_start = None; continue
            if s >= t:
                if run_start is None or now - last > gap_s + HOP_S:
                    run_start = now - HOP_S
                last = now
            elif run_start is not None and now - last > gap_s:
                run_start = None
            if run_start is not None and last - run_start >= req_s:
                hits += 1; run_start = None; cool = now + 20
        return hits

    def evaluate(split):
        S, N, Nsecs, clipS, clipN = [], [], 0.0, [], []
        for f, lab, sp, src in items:
            if sp != split:
                continue
            seq = window_scores(f)
            (S if lab else N).append(seq)
            (clipS if lab else clipN).append(float(seq.max()))
            if not lab:
                Nsecs += len(seq) * HOP_S
        joined = np.concatenate(N)
        grid = []
        for t in (0.5, 0.7, 0.8, 0.9, 0.95):
            for req in (1.0, 2.0, 3.0):
                grid.append(dict(threshold=t, sustained_s=req,
                                 recall=round(float(np.mean([sos_count(q, t, req) > 0 for q in S])), 3),
                                 false_sos_per_hour=round(sos_count(joined, t, req) / (Nsecs / 3600), 2)))
        auc = roc_auc_score([1] * len(clipS) + [0] * len(clipN), clipS + clipN)
        return dict(clip_auc=round(float(auc), 4), screams=len(S), negatives=len(N),
                    negative_hours=round(Nsecs / 3600, 2), grid=grid)

    val = evaluate('val')
    # Operating point: the most recall with at most 1 false SOS per hour on validation
    ok = [g for g in val['grid'] if g['false_sos_per_hour'] <= 1.0]
    best = max(ok, key=lambda g: (g['recall'], -g['false_sos_per_hour'])) if ok else max(val['grid'], key=lambda g: g['threshold'])
    test = evaluate('test')
    chosen_test = next(g for g in test['grid'] if g['threshold'] == best['threshold'] and g['sustained_s'] == best['sustained_s'])
    report = dict(model='YAMNet + scream head', chosen=best, test_at_chosen=chosen_test,
                  test_clip_auc=test['clip_auc'], val=val, test=test)
    print(json.dumps(dict(chosen=best, test_at_chosen=chosen_test, test_clip_auc=test['clip_auc']), indent=2))

    # --- Export: waveform [15600] -> YAMNet embedding -> head -> probability, as one TFLite
    dense = [l for l in head.layers if isinstance(l, tf.keras.layers.Dense)]
    (W1, b1), (W2, b2) = dense[0].get_weights(), dense[1].get_weights()
    W1, b1, W2, b2 = (tf.constant(x) for x in (W1, b1, W2, b2))

    @tf.function(input_signature=[tf.TensorSpec([FRAME], tf.float32)])
    def scream_prob(waveform):
        _, emb, _ = Y(waveform)
        h = tf.nn.relu(tf.matmul(emb[:1], W1) + b1)
        return tf.sigmoid(tf.matmul(h, W2) + b2)

    conv = tf.lite.TFLiteConverter.from_concrete_functions([scream_prob.get_concrete_function()], Y)
    conv.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS]
    tfl = conv.convert()
    out = os.path.join(a.out, 'scream_detection.tflite')
    open(out, 'wb').write(tfl)

    # parity on real test windows
    it = tf.lite.Interpreter(model_content=tfl); it.allocate_tensors()
    i, o = it.get_input_details()[0], it.get_output_details()[0]
    diffs = []
    for f, lab, sp, src in [x for x in items if x[2] == 'test'][:30]:
        y, _ = librosa.load(f, sr=SR, mono=True)
        w = np.pad(y, (0, max(0, FRAME - len(y))))[:FRAME].astype(np.float32)
        it.set_tensor(i['index'], w); it.invoke()
        diffs.append(abs(float(it.get_tensor(o['index']).ravel()[0]) - float(scream_prob(w).numpy().ravel()[0])))
    report.update(tflite_kb=round(len(tfl) / 1024), tflite_max_diff=float(max(diffs)),
                  input=str(i['shape']), output=str(o['shape']))
    json.dump(report, open(os.path.join(a.out, 'scream_report.json'), 'w'), indent=2)
    print('TFLite', report['tflite_kb'], 'KB  input', report['input'], 'max diff vs TF', report['tflite_max_diff'])


if __name__ == '__main__':
    main()
