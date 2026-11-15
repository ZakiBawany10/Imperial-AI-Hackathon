"""Tune the physics engine so it climbs the way real climbers do.

Usage:  python3 train_physics.py [n_configs]        (default 60)

Data: wayup.py, 22 recorded climbs (11 people, 2 routes, 8.5 m vertical wall).
For each climb the engine gets the same holds, the same start holds and top hold, and a
climber of the same height, and chooses its own sequence (limbs.safest_hands, then feet by
limbs.plan). It is scored against what the person did:

  hand holds   F1 of the set of holds the hands used (start holds left out)
  foot holds   F1 of the set of holds the feet used
  order        longest common run of hand holds, in order, over the longer of the two lists
  same hand    of the holds both used, the share first taken by the same hand
  score        the mean of those four (1.0 = exactly what the person did)

The guessed numbers in limbs.py, physics.py and pose.py are then tuned by random search to
raise the score on the experts' climbs (5+ years of climbing), and checked two ways:
  random   5 folds over the 22 climbs
  test     one route held out: tuned on one route, scored on the other
A tuned setting is shipped only if it beats the current one on both.
Writes results_physics_training.json and, when it wins, models/physics_params.json.
"""
import json
import math
import os
import random
import sys
from multiprocessing import Pool

import numpy as np

import beta_solver
import limbs
import physics
import pose
import wayup

HERE = os.path.dirname(os.path.abspath(__file__))
PARAMS = {   # name: (module, attribute, low, high)
    "FALL_AT": (limbs, "FALL_AT", 0.7, 1.2), "FALL_SPREAD": (limbs, "FALL_SPREAD", 0.03, 0.2),
    "REACH_RISK": (limbs, "REACH_RISK", 0.0, 0.9), "REACH_FROM": (limbs, "REACH_FROM", 0.25, 0.85),
    "MOVE_COST": (limbs, "MOVE_COST", 0.0, 0.1),
    "SWITCH": (limbs, "SWITCH", 0.0, 0.4), "DOWN_STEP": (limbs, "DOWN_STEP", 0.0, 1.5),
    "NEXT_HOLDS": (limbs, "NEXT_HOLDS", 3, 8),
    "GRIP_MAX": (physics, "GRIP_MAX", 0.8, 1.6), "GRIP_WORST": (physics, "GRIP_WORST", 0.2, 0.7),
    "BODY_OUT_M": (physics, "BODY_OUT_M", 0.12, 0.35), "FOOT_CONE_DEG": (physics, "FOOT_CONE_DEG", 25, 60),
    "HANG": (pose, "HANG", 0.55, 0.95),
}
DEFAULTS = {k: getattr(m, a) for k, (m, a, _, _) in PARAMS.items()}
SEED = 0


def apply(cfg):
    for k, v in cfg.items():
        m, a, _, _ = PARAMS[k]
        setattr(m, a, int(round(v)) if k == "NEXT_HOLDS" else v)


def setup(climb):
    unit = 0.2 * climb["height_m"] / 1.75
    pts = [(h["x"] / unit, h["y"] / unit) for h in climb["holds"]]
    hand_ok = [i for i, h in enumerate(climb["holds"]) if not h["foot_only"]]
    first = {}
    for limb, hold in climb["hands"]:
        first.setdefault(limb, hold)
    start = sorted({first.get("LH"), first.get("RH")} - {None})
    top = max((h for _, h in climb["hands"]), key=lambda i: pts[i][1])
    floor = (min(h["y"] for h in climb["holds"]) - 0.3) / unit
    hand_ok = sorted(set(hand_ok) | set(start) | {top})
    return unit, pts, hand_ok, start, top, floor


def run(climb, cfg, method="safest"):
    """The engine's sequence for one climb: (hand moves [(limb, hold)], foot holds used)."""
    apply(cfg)
    unit, pts, hand_ok, start, top, floor = setup(climb)
    kinds = ["foot" if h["foot_only"] else "unknown" for h in climb["holds"]]
    body_out = physics.BODY_OUT_M / unit
    if method == "safest":
        r = limbs.safest_hands(pts, start, [top], kinds=kinds, floor=floor, body_out=body_out, hand_ok=hand_ok)
        if not r:
            return None
        states = r["states"]
    else:                                                  # the geometric search the grade model uses
        sub = hand_ok
        idx = {j: i for i, j in enumerate(sub)}
        moves = beta_solver.solve([pts[j] for j in sub], [idx[s] for s in start], [idx[top]], {}, {})
        if not moves:
            return None
        s0 = tuple(sorted([idx[s] for s in start][:2], key=lambda i: pts[sub[i]][0])) if len(start) >= 2 else (idx[start[0]],) * 2
        states = [tuple(sub[i] for i in s) for s in [s0] + [m["state"] for m in moves]]
    hands = []
    for a, b in zip(states, states[1:]):
        hands.append(("LH", b[0]) if a[0] != b[0] else ("RH", b[1]))
    plan = limbs.plan(pts, states, kinds=kinds, angle_deg=0.0, height=limbs.HEIGHT, body_out=body_out, floor=floor)
    feet = {f["contacts"][l] for f in plan["frames"] for l in ("LF", "RF")} - {None}
    return hands, feet, start


def lcs(a, b):
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i, x in enumerate(a):
        for j, y in enumerate(b):
            dp[i + 1][j + 1] = dp[i][j] + 1 if x == y else max(dp[i][j + 1], dp[i + 1][j])
    return dp[-1][-1]


def f1(a, b):
    if not a and not b:
        return 1.0
    inter = len(a & b)
    return 2 * inter / (len(a) + len(b)) if (a or b) else 0.0


def compare(climb, result):
    if result is None:
        return {"hand_holds": 0.0, "foot_holds": 0.0, "order": 0.0, "same_hand": 0.0, "score": 0.0, "moves": 0, "solved": 0}
    hands, feet, start = result
    human_hands = [(l, h) for l, h in climb["hands"]]
    human_feet = {h for _, limb, h in climb["events"] if limb[1] == "F" and h is not None}
    hs_h = {h for _, h in human_hands} - set(start)
    hs_m = {h for _, h in hands} - set(start)
    seq_h, seq_m = [h for _, h in human_hands], [h for _, h in hands]
    order = lcs(seq_h, seq_m) / max(len(seq_h), len(seq_m), 1)
    first_h, first_m = {}, {}
    for l, h in human_hands:
        first_h.setdefault(h, l)
    for l, h in hands:
        first_m.setdefault(h, l)
    both = set(first_h) & set(first_m)
    same = sum(first_h[h] == first_m[h] for h in both) / len(both) if both else 0.0
    out = {"hand_holds": f1(hs_h, hs_m), "foot_holds": f1(human_feet, feet), "order": order, "same_hand": same,
           "moves": len(hands), "human_moves": len(human_hands), "solved": 1}
    out["score"] = float(np.mean([out["hand_holds"], out["foot_holds"], out["order"], out["same_hand"]]))
    return out


def _task(args):
    i, cfg, method = args
    climb = CLIMBS[i]
    try:
        return compare(climb, run(climb, cfg, method))
    except Exception as e:                                 # a setting can make a climb impossible; score it 0
        return compare(climb, None)


CLIMBS = wayup.climbs()
if os.environ.get("ASCEND_CLIMBS") == "1":       # add the climbs the app's live camera recorded
    import climbs_store
    CLIMBS += climbs_store.training_climbs()


def evaluate(pool, configs, method="safest"):
    """scores[c][i] = comparison for config c on climb i."""
    tasks = [(i, cfg, method) for cfg in configs for i in range(len(CLIMBS))]
    flat = pool.map(_task, tasks, chunksize=4)
    n = len(CLIMBS)
    return [flat[c * n:(c + 1) * n] for c in range(len(configs))]


def mean_score(rows, idx, experts_only=True):
    use = [i for i in idx if CLIMBS[i]["expert"]] if experts_only else list(idx)
    use = use or list(idx)
    return float(np.mean([rows[i]["score"] for i in use]))


def summary(rows, idx):
    keys = ("score", "hand_holds", "foot_holds", "order", "same_hand")
    out = {k: round(float(np.mean([rows[i][k] for i in idx])), 3) for k in keys}
    out["experts_score"] = round(mean_score(rows, idx, True), 3)
    out["moves_vs_people"] = round(float(np.mean([rows[i]["moves"] / max(rows[i].get("human_moves", 1), 1) for i in idx])), 2)
    return out


def main():
    n_cfg = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    rng = random.Random(SEED)
    configs = [dict(DEFAULTS)]
    for _ in range(n_cfg):
        c = {}
        for k, (_, _, lo, hi) in PARAMS.items():
            # half the time keep the current value, so changes stay small and readable
            c[k] = DEFAULTS[k] if rng.random() < 0.4 else rng.uniform(lo, hi)
        c["GRIP_WORST"] = min(c["GRIP_WORST"], c["GRIP_MAX"] - 0.1)
        configs.append(c)
    with Pool() as pool:
        geo = evaluate(pool, [DEFAULTS], "geometric")[0]
        scores = evaluate(pool, configs)
    all_idx = list(range(len(CLIMBS)))
    rng_idx = list(all_idx)
    random.Random(SEED).shuffle(rng_idx)
    folds = {"random": [(sorted(set(all_idx) - set(rng_idx[k::5])), sorted(rng_idx[k::5])) for k in range(5)],
             "test": [([i for i in all_idx if CLIMBS[i]["route"] == r], [i for i in all_idx if CLIMBS[i]["route"] != r])
                      for r in ("green", "orange")]}
    results = {}
    for name, fs in folds.items():
        tuned_rows = [None] * len(CLIMBS)
        picks = []
        for tr, te in fs:
            best = max(range(len(configs)), key=lambda c: mean_score(scores[c], tr))
            picks.append(best)
            for i in te:
                tuned_rows[i] = scores[best][i]
        results[name] = {"geometric search (old)": summary(geo, all_idx),
                         "safest route, current settings": summary(scores[0], all_idx),
                         "safest route, tuned on the other folds": summary(tuned_rows, all_idx),
                         "settings picked per fold": picks}
    best_all = max(range(len(configs)), key=lambda c: mean_score(scores[c], all_idx))
    wins = all(results[n]["safest route, tuned on the other folds"]["experts_score"] >
               results[n]["safest route, current settings"]["experts_score"] for n in results)
    out = {"climbs": len(CLIMBS), "experts": sum(c["expert"] for c in CLIMBS), "configs_tried": len(configs),
           "results": results, "best_on_all": {k: round(v, 4) for k, v in configs[best_all].items()},
           "best_on_all_summary": summary(scores[best_all], all_idx), "shipped": bool(wins and best_all != 0),
           "per_climb_current": [{"id": CLIMBS[i]["id"], **{k: round(v, 3) if isinstance(v, float) else v for k, v in scores[0][i].items()}} for i in all_idx]}
    ours = [i for i in all_idx if CLIMBS[i]["id"].startswith("ascend-")]
    if ours:                                       # the app's own recorded climbs, scored alone
        out["ascend_climbs"] = {"climbs": len(ours), "current settings": summary(scores[0], ours),
                                "best on all": summary(scores[best_all], ours)}
        print("ascend climbs alone:", out["ascend_climbs"])
    for name, r in results.items():
        print(f"--- {name} split")
        for k, v in r.items():
            print(f"  {k:42s} {v}")
    print("best on all:", out["best_on_all"], out["best_on_all_summary"])
    print("ship tuned settings:", out["shipped"])
    json.dump(out, open(os.path.join(HERE, "results_physics_training.json"), "w"), indent=1)
    if out["shipped"]:
        json.dump(out["best_on_all"], open(os.path.join(HERE, "models", "physics_params.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
