"""Test thesis: can we predict a boulder grade from hold layout, and do features
from a solved climbing sequence help?

Usage:  python3 test_thesis.py /path/to/MoonBoardRNN

Data: MoonBoard 2016 problems from github.com/jrchang612/MoonBoardRNN
      (raw_data/moonGen_scrape_2016_final + expert hold difficulty CSVs).
"""
import json
import sys
from multiprocessing import Pool

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

import beta_solver
from safe_load import load

GRADES = ["6B", "6B+", "6C", "6C+", "7A", "7A+", "7B", "7B+", "7C", "7C+", "8A", "8A+", "8B", "8B+"]
G2I = {g: i for i, g in enumerate(GRADES)}
MIN_REPEATS = 2      # drop problems almost nobody has climbed: their grades are one person's guess
SEED = 0

ROOT = sys.argv[1].rstrip("/") + "/"
BAD_L, BAD_R = {}, {}


def load_hold_tables(sign):
    """sign=+1 if a higher expert score means a better hold."""
    for name, table in (("Left", BAD_L), ("Right", BAD_R)):
        df = pd.read_csv(ROOT + f"raw_data/HoldFeature2016{name}Hand.csv", usecols=[0, 1, 2])
        df.columns = ["x", "y", "s"]
        for x, y, s in df.itertuples(index=False):
            good = s / 9.0
            table[(int(x), int(y))] = 1.0 - good if sign > 0 else good


def _init_worker(bad_l, bad_r):
    # macOS starts workers with "spawn", so they do not inherit the filled tables.
    BAD_L.update(bad_l)
    BAD_R.update(bad_r)


def one(row):
    holds, s_idx, e_idx = row
    return beta_solver.features(holds, s_idx, e_idx, BAD_L, BAD_R)


def report(name, y_true, pred):
    err = np.abs(pred - y_true)
    r = np.clip(np.rint(pred), 0, len(GRADES) - 1)
    out = dict(model=name, mae=round(float(err.mean()), 3),
               exact=round(float((r == y_true).mean()), 3),
               within1=round(float((np.abs(r - y_true) <= 1).mean()), 3))
    print(out)
    return out


def fit_predict(Xtr, ytr, Xte):
    m = lgb.LGBMRegressor(n_estimators=600, learning_rate=0.04, num_leaves=48,
                          subsample=0.8, subsample_freq=1, colsample_bytree=0.7,
                          random_state=SEED, verbose=-1)
    m.fit(Xtr, ytr)
    return m, m.predict(Xte)


def main():
    raw = load(ROOT + "raw_data/moonGen_scrape_2016_final")
    rows, meta = [], []
    for pid, p in raw.items():
        if p["grade"] not in G2I or not p["start"] or not p["end"]:
            continue
        if (p.get("repeats") or 0) < MIN_REPEATS:
            continue
        holds = [tuple(h) for h in p["start"] + p["mid"] + p["end"]]
        if len(set(holds)) != len(holds):
            continue
        ns, ne = len(p["start"]), len(p["end"])
        rows.append((holds, list(range(ns)), list(range(len(holds) - ne, len(holds)))))
        meta.append((pid, G2I[p["grade"]], bool(p["is_benchmark"]), p["repeats"]))
    y = np.array([m[1] for m in meta], dtype=float)
    bench = np.array([m[2] for m in meta])
    print(f"problems kept: {len(rows)} (benchmarks: {bench.sum()})")

    # Which way does the expert hold score run? Check against grade, on raw scores.
    load_hold_tables(+1)
    mean_bad = np.array([np.mean([(BAD_L.get(h, .5) + BAD_R.get(h, .5)) / 2 for h in r[0]]) for r in rows])
    corr = np.corrcoef(mean_bad, y)[0, 1]
    sign = +1 if corr > 0 else -1
    print(f"corr(mean hold badness assuming high=good, grade) = {corr:.3f} -> high score means {'good' if sign > 0 else 'bad'} hold")
    BAD_L.clear(); BAD_R.clear(); load_hold_tables(sign)
    if "--no-hold-quality" in sys.argv:
        # Ablation: pretend we know nothing about how good each hold is (the gym-photo worst case).
        BAD_L.clear(); BAD_R.clear()
        print("ABLATION: hold quality removed, geometry only")

    with Pool(initializer=_init_worker, initargs=(dict(BAD_L), dict(BAD_R))) as pool:
        feats = pool.map(one, rows, chunksize=200)
    F = pd.DataFrame(feats)
    print(f"solver found a sequence for {F.solved.mean():.1%} of problems")

    bag = np.zeros((len(rows), 11 * 18), dtype=np.float32)
    for i, (holds, s_idx, e_idx) in enumerate(rows):
        for (x, yy) in holds:
            bag[i, x * 18 + yy] = 1
    B = pd.DataFrame(bag, columns=[f"h{i}" for i in range(bag.shape[1])])

    idx = np.arange(len(rows))
    tr, te = train_test_split(idx, test_size=0.2, random_state=SEED, stratify=y)
    results = []
    results.append(report("always guess the median grade", y[te], np.full(len(te), np.median(y[tr]))))
    _, p = fit_predict(B.iloc[tr], y[tr], B.iloc[te]);            results.append(report("raw holds only", y[te], p))
    mF, p = fit_predict(F.iloc[tr], y[tr], F.iloc[te]);           results.append(report("solver features only (24 numbers)", y[te], p))
    X = pd.concat([B, F], axis=1)
    _, p = fit_predict(X.iloc[tr], y[tr], X.iloc[te]);            results.append(report("raw holds + solver features", y[te], p))
    tb = te[bench[te]]
    if len(tb):
        results.append(report(f"  ...same model, benchmark problems only (n={len(tb)})", y[tb], p[bench[te]]))

    imp = sorted(zip(F.columns, mF.feature_importances_), key=lambda t: -t[1])[:8]
    print("top solver features:", imp)
    json.dump(dict(n=len(rows), n_test=len(te), hold_score_corr=round(float(corr), 3),
                   solved=round(float(F.solved.mean()), 4), results=results,
                   top_solver_features=[(a, int(b)) for a, b in imp]),
              open("results_no_hold_quality.json" if "--no-hold-quality" in sys.argv else "results.json", "w"),
              indent=2)


if __name__ == "__main__":
    main()
