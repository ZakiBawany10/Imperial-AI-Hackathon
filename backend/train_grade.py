"""Train the grade model the API serves, and check whether MoonBoard helps.

Usage:  python3 train_grade.py data/kilter_hf/kilter_splits.sqlite data/MoonBoardRNN

Step 1 compares two training sets on each board's held-out climbs:
    Kilter only   vs   Kilter + MoonBoard
Step 2 trains the chosen set on all rows and saves three models to models/:
    the grade, and a low and high bound (15th and 85th percentile).

Grades are Kilter difficulty numbers (10 = 4a/V0 ... 31 = 8b+/V14). MoonBoard
Font grades are mapped onto the same scale (6B = 18).

The model only sees solver features, wall angle and the number of foot-only
holds. It never sees which board a climb came from, so it can be given a gym route.
"""
import json
import sys
from multiprocessing import Pool

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.model_selection import GroupShuffleSplit, train_test_split

import beta_solver
import test_kilter as tk
from safe_load import load

SEED = 0
MB_GRADES = ["6B", "6B+", "6C", "6C+", "7A", "7A+", "7B", "7B+", "7C", "7C+", "8A", "8A+", "8B", "8B+"]
MB_OFFSET = 18           # MoonBoard 6B is Kilter difficulty 18 (6b/V4)
MB_ANGLE = 40.0          # the 2016 MoonBoard is set at 40 degrees
MB_MIN_REPEATS = 2
QUANTILES = {"low": 0.15, "high": 0.85}
_MB_BAD = ({}, {})


def _mb_init(bad_l, bad_r):
    _MB_BAD[0].update(bad_l)
    _MB_BAD[1].update(bad_r)


def _mb_one(row):
    return beta_solver.features(row[0], row[1], row[2], _MB_BAD[0], _MB_BAD[1])


def moonboard(root):
    """Returns (features, grade) for MoonBoard 2016, using the expert hold scores."""
    root = root.rstrip("/") + "/"
    bad = []
    for name in ("Left", "Right"):
        df = pd.read_csv(root + f"raw_data/HoldFeature2016{name}Hand.csv", usecols=[0, 1, 2])
        df.columns = ["x", "y", "s"]
        # test_thesis.py checks the direction: a high expert score is a good hold.
        bad.append({(int(x), int(y)): 1.0 - s / 9.0 for x, y, s in df.itertuples(index=False)})
    rows, y = [], []
    for p in load(root + "raw_data/moonGen_scrape_2016_final").values():
        if p["grade"] not in MB_GRADES or not p["start"] or not p["end"]:
            continue
        if (p.get("repeats") or 0) < MB_MIN_REPEATS:
            continue
        holds = [tuple(h) for h in p["start"] + p["mid"] + p["end"]]
        if len(set(holds)) != len(holds):
            continue
        ns, ne = len(p["start"]), len(p["end"])
        rows.append((holds, list(range(ns)), list(range(len(holds) - ne, len(holds)))))
        y.append(MB_OFFSET + MB_GRADES.index(p["grade"]))
    with Pool(initializer=_mb_init, initargs=tuple(bad)) as pool:
        F = pd.DataFrame(pool.map(_mb_one, rows, chunksize=200))
    F["angle"] = MB_ANGLE
    F["n_foot_only"] = 0
    return F, np.array(y, dtype=float)


def kilter_features(df, climbs, foot_ids, bad):
    uuids = list(climbs)
    row_of = {u: i for i, u in enumerate(uuids)}
    F = tk.solve_all([climbs[u] for u in uuids], bad).iloc[df.uuid.map(row_of).to_numpy()].reset_index(drop=True)
    F["angle"] = df.angle.to_numpy()
    F["n_foot_only"] = df.uuid.map(lambda u: len(foot_ids[u])).to_numpy()
    return F


def fit(X, y, objective="regression", alpha=None):
    extra = {"alpha": alpha} if alpha is not None else {}
    m = lgb.LGBMRegressor(n_estimators=600, learning_rate=0.04, num_leaves=48,
                          subsample=0.8, subsample_freq=1, colsample_bytree=0.7,
                          random_state=SEED, verbose=-1, objective=objective, **extra)
    return m.fit(X, y)


def score(name, y_true, pred):
    r, t = np.rint(pred), np.rint(y_true)
    out = dict(model=name, mae=round(float(np.abs(pred - y_true).mean()), 3),
               exact=round(float((r == t).mean()), 3),
               within1=round(float((np.abs(r - t) <= 1).mean()), 3))
    print(out)
    return out


def main():
    kilter_path, mb_root = sys.argv[1], sys.argv[2]
    df, climbs, hand_ids, foot_ids, xy = tk.load_climbs(kilter_path)
    yk = df.grade.to_numpy(float)
    ktr, kte = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED).split(df, groups=df.uuid))
    Fk = kilter_features(df, climbs, foot_ids, tk.learn_quality(df.iloc[ktr], hand_ids, xy))

    Fm, ym = moonboard(mb_root)
    mtr, mte = train_test_split(np.arange(len(ym)), test_size=0.2, random_state=SEED, stratify=ym)
    cols = list(Fk.columns)
    Fm = Fm[cols]
    print(f"kilter rows {len(df)}, moonboard problems {len(ym)}, features {len(cols)}")

    # Step 1: does adding MoonBoard help or hurt on each board's held-out climbs?
    results = []
    k_only = fit(Fk.iloc[ktr], yk[ktr])
    both = fit(pd.concat([Fk.iloc[ktr], Fm.iloc[mtr]]), np.concatenate([yk[ktr], ym[mtr]]))
    mb_only = fit(Fm.iloc[mtr], ym[mtr])
    for label, m in (("kilter only", k_only), ("kilter + moonboard", both), ("moonboard only", mb_only)):
        results.append(score(f"trained on {label}, tested on kilter", yk[kte], m.predict(Fk.iloc[kte])))
        results.append(score(f"trained on {label}, tested on moonboard", ym[mte], m.predict(Fm.iloc[mte])))
        easy = yk[kte] < 18
        results.append(score(f"trained on {label}, tested on kilter below 6b/V4 (n={int(easy.sum())})",
                             yk[kte][easy], m.predict(Fk.iloc[kte][easy])))
    k_k, b_k = results[0]["mae"], results[3]["mae"]
    k_m, b_m = results[1]["mae"], results[4]["mae"]
    k_e, b_e = results[2]["mae"], results[5]["mae"]
    # Keep MoonBoard only if it does not cost accuracy where gym routes live (Kilter, and its easy end).
    use_mb = b_k <= k_k + 0.02 and b_e <= k_e + 0.02 and b_m < k_m
    chosen = "kilter + moonboard" if use_mb else "kilter only"
    print(f"chosen training set: {chosen}")

    # Step 2: final models on all rows of the chosen set. Hold quality is relearned from all Kilter rows.
    X = kilter_features(df, climbs, foot_ids, tk.learn_quality(df, hand_ids, xy))[cols]
    y = yk
    if use_mb:
        X, y = pd.concat([X, Fm]), np.concatenate([yk, ym])
    fit(X, y).booster_.save_model("models/grade.txt")
    for name, q in QUANTILES.items():
        fit(X, y, objective="quantile", alpha=q).booster_.save_model(f"models/grade_{name}.txt")
    meta = dict(features=cols, trained_on=chosen, rows=int(len(y)), quantiles=QUANTILES, comparison=results)
    json.dump(meta, open("models/grade_meta.json", "w"), indent=2)
    json.dump(dict(chosen=chosen, kilter_rows=int(len(df)), moonboard_problems=int(len(ym)), results=results),
              open("results_grade_model.json", "w"), indent=2)


if __name__ == "__main__":
    main()
