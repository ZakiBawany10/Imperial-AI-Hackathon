"""Repeat the thesis test on Kilter board data: easier grades and many wall angles.

Usage:  python3 test_kilter.py data/kilter_hf/kilter_splits.sqlite

Data: huggingface.co/datasets/Vilin97/KilterBoard (MIT), built from BoardLib + the Kilter app.
      Layout 1 (12x12 original), one row per (climb, wall angle).

Differences from test_thesis.py:
- Kilter has no expert hold scores. "Learned hold quality" is worked out from the
  training climbs only: a hold is bad if climbs using it are graded harder than
  other climbs at the same wall angle.
- The 80/20 split is by climb, so one climb at two angles never lands on both sides.
- Error is in Kilter difficulty steps, which are the same Font steps (6a, 6a+, 6b ...).
"""
import json
import re
import sqlite3
import sys
from collections import defaultdict
from multiprocessing import Pool

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.model_selection import GroupShuffleSplit

import beta_solver

SEED = 0
MIN_ASCENTS = 5          # grades with fewer ascents are a handful of people's guess
INCH_PER_UNIT = 7.874    # beta_solver works in 0.2 m grid units; Kilter x, y are inches
START, MIDDLE, FINISH, FOOT = 12, 13, 14, 15
FRAME = re.compile(r"p(\d+)r(\d+)")
BAD = {}


def _init_worker(bad):
    BAD.update(bad)


def one(climb):
    holds, s_idx, e_idx = climb
    return beta_solver.features(holds, s_idx, e_idx, BAD, BAD)


def solve_all(climbs, bad):
    with Pool(initializer=_init_worker, initargs=(bad,)) as pool:
        return pd.DataFrame(pool.map(one, climbs, chunksize=200))


def report(name, y_true, pred):
    err = np.abs(pred - y_true)
    r, t = np.rint(pred), np.rint(y_true)
    out = dict(model=name, mae=round(float(err.mean()), 3),
               exact=round(float((r == t).mean()), 3),
               within1=round(float((np.abs(r - t) <= 1).mean()), 3))
    print(out)
    return out


def fit_predict(Xtr, ytr, Xte):
    m = lgb.LGBMRegressor(n_estimators=600, learning_rate=0.04, num_leaves=48,
                          subsample=0.8, subsample_freq=1, colsample_bytree=0.7,
                          random_state=SEED, verbose=-1)
    m.fit(Xtr, ytr)
    return m.predict(Xte)


def load_climbs(path):
    """Returns (df, climbs, hand_ids, foot_ids, xy). One df row per (climb, wall angle)."""
    con = sqlite3.connect(path)
    xy = {pid: (x / INCH_PER_UNIT, y / INCH_PER_UNIT) for pid, x, y in con.execute(
        "select p.id, h.x, h.y from placements p join holes h on h.id = p.hole_id")}
    df = pd.concat([pd.read_sql(
        f"select uuid, angle, difficulty_average as grade, ascensionist_count as n, frames from {t}", con)
        for t in ("kilter_train", "kilter_val", "kilter_test")])
    df = df[df.n >= MIN_ASCENTS].reset_index(drop=True)

    # One solver input per climb (the hold layout does not change with wall angle).
    climbs, hand_ids, foot_ids = {}, {}, {}
    for uuid, frames in zip(df.uuid, df.frames):
        if uuid in climbs:
            continue
        pr = [(int(p), int(r)) for p, r in FRAME.findall(frames)]
        if any(p not in xy for p, _ in pr):
            continue
        order = [p for p, r in pr if r == START] + [p for p, r in pr if r == MIDDLE] + [p for p, r in pr if r == FINISH]
        ns, ne = sum(r == START for _, r in pr), sum(r == FINISH for _, r in pr)
        if not ns or not ne or len(set(order)) != len(order):
            continue
        climbs[uuid] = ([xy[p] for p in order], list(range(ns)), list(range(len(order) - ne, len(order))))
        hand_ids[uuid] = order
        foot_ids[uuid] = [p for p, r in pr if r == FOOT]
    df = df[df.uuid.isin(climbs)].reset_index(drop=True)
    return df, climbs, hand_ids, foot_ids, xy


def learn_quality(train, hand_ids, xy):
    """Hold badness 0..1 keyed by (x, y), learned from the given rows only."""
    resid = train.grade - train.groupby("angle").grade.transform("mean")
    tot, cnt = defaultdict(float), defaultdict(int)
    for uuid, r in zip(train.uuid, resid):
        for p in hand_ids[uuid]:
            tot[p] += r
            cnt[p] += 1
    score = {p: tot[p] / (cnt[p] + 20) for p in tot}          # shrink rarely used holds to 0
    lo, hi = np.percentile(list(score.values()), [2, 98])
    return {xy[p]: float(np.clip((s - lo) / (hi - lo), 0, 1)) for p, s in score.items()}


def main():
    df, climbs, hand_ids, foot_ids, xy = load_climbs(sys.argv[1])
    y = df.grade.to_numpy(float)
    print(f"rows kept: {len(df)} from {len(climbs)} climbs, grades {y.min():.0f} to {y.max():.0f}, "
          f"angles {df.angle.min():.0f} to {df.angle.max():.0f}")

    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED).split(df, groups=df.uuid))

    # Learned hold quality, from training rows only.
    learned = learn_quality(df.iloc[tr], hand_ids, xy)

    uuids = list(climbs)
    row_of = {u: i for i, u in enumerate(uuids)}
    rows = df.uuid.map(row_of).to_numpy()
    todo = [climbs[u] for u in uuids]
    F_geo = solve_all(todo, {}).iloc[rows].reset_index(drop=True)
    F_q = solve_all(todo, learned).iloc[rows].reset_index(drop=True)
    print(f"solver found a sequence for {F_geo.solved.mean():.1%} of rows")
    extra = pd.DataFrame({"angle": df.angle, "n_foot_only": df.uuid.map(lambda u: len(foot_ids[u]))})
    F_geo, F_q = pd.concat([F_geo, extra], axis=1), pd.concat([F_q, extra], axis=1)

    col = {p: i for i, p in enumerate(sorted(xy))}
    bag = np.zeros((len(df), 2 * len(col)), dtype=np.float32)
    for i, u in enumerate(df.uuid):
        for p in hand_ids[u]:
            bag[i, col[p]] = 1
        for p in foot_ids[u]:
            bag[i, len(col) + col[p]] = 1
    B = pd.DataFrame(bag, columns=[f"h{i}" for i in range(bag.shape[1])])
    B["angle"] = df.angle

    ytr, yte = y[tr], y[te]
    results = [report("always guess the median grade", yte, np.full(len(te), np.median(ytr)))]
    A = df[["angle"]]
    results.append(report("wall angle only", yte, fit_predict(A.iloc[tr], ytr, A.iloc[te])))
    results.append(report("solver features, geometry only + angle", yte, fit_predict(F_geo.iloc[tr], ytr, F_geo.iloc[te])))
    results.append(report("solver features, learned hold quality + angle", yte, fit_predict(F_q.iloc[tr], ytr, F_q.iloc[te])))
    results.append(report("raw holds + angle", yte, fit_predict(B.iloc[tr], ytr, B.iloc[te])))
    X = pd.concat([B.drop(columns="angle"), F_q], axis=1)
    p = fit_predict(X.iloc[tr], ytr, X.iloc[te])
    results.append(report("raw holds + solver features + angle", yte, p))
    easy = yte < 18                                             # below 6b / V4: the range MoonBoard lacks
    results.append(report(f"  ...same model, climbs below 6b/V4 only (n={int(easy.sum())})", yte[easy], p[easy]))

    json.dump(dict(rows=len(df), climbs=len(climbs), n_test=len(te), min_ascents=MIN_ASCENTS, results=results),
              open("results_kilter.json", "w"), indent=2)


if __name__ == "__main__":
    main()
