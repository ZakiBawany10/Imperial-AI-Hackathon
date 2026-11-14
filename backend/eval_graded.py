"""Grade prediction on a real gym wall: The A's spray wall (Minneapolis), graded V0 to V11.

Usage:  python3 eval_graded.py [wall_height_m] [wall_angle_deg]     (defaults 4.0 and 0)

Data: the guidebook problems in "wall training images/graded-climbs" (106) and the four
in "graded-climbs-more/photos/exact-grades" from The A. graded_holds.py reads each
picture's marked holds, start holds (tails) and finish hold (double outline).

Not known from the picture, so assumed (and shown in the results): every hold is an
average hold (quality 0.5, type unknown); the picture's height is wall_height_m of wall;
the wall's angle; a 1.75 m climber.

Rows of the results:
  - always guess the middle grade (the baseline);
  - the served grade model, as the app would answer (trained on boards only, never on
    this wall);
  - the same, rescaled to this wall by a straight line fitted on training folds only;
  - models fitted on this wall from the solver's numbers, with and without the physics
    engine's numbers.
Two ways to split, both 5 folds:
  random  every problem is equally likely to land in any fold;
  test    problems from one guidebook page always land in the same fold. A page shows
          one section of the wall, so the model is scored on wall sections it never saw.
"""
import csv
import json
import os
import sys

import numpy as np
from scipy.stats import spearmanr
from sklearn.linear_model import Ridge
from sklearn.model_selection import GroupKFold, KFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import beta_solver
import graded_holds
import limbs
import route

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "wall training images")
SEED = 0


def problems():
    rows = []
    for r in csv.DictReader(open(os.path.join(ROOT, "graded-climbs", "labels.csv"), encoding="utf-8-sig")):
        rows.append({"path": os.path.join(ROOT, "graded-climbs", r["image_path"]), "name": r["route_name"],
                     "v": int(r["grade"].lstrip("V")), "page": "v15-" + r["source_page_number"]})
    more = os.path.join(ROOT, "graded-climbs-more", "labels.csv")
    if os.path.exists(more):
        for r in csv.DictReader(open(more, encoding="utf-8-sig")):
            if r["gym"] == "The A" and r["label_type"] != "circuit_range" and r["grade_min"] == r["grade_max"]:
                rows.append({"path": os.path.join(ROOT, "graded-climbs-more", r["image_path"]), "name": r["route_name"],
                             "v": int(r["grade_min"]), "page": "v09-" + r["route_name"]})
    return rows


def request(found, wall_m, angle):
    holds = [{"id": h["id"], "x": h["x"], "y": h["y"], "w": h["w"], "h": h["h"], "type": "unknown", "quality": 0.5}
             for h in found["holds"]]
    by_y = sorted(found["holds"], key=lambda h: -h["y"])                 # lowest first
    start = [h["id"] for h in by_y if h["start"]][:2] or [by_y[0]["id"]]
    finish = [h["id"] for h in found["holds"] if h["finish"] and h["id"] not in start][:1] \
        or [next(h["id"] for h in reversed(by_y) if h["id"] not in start)]
    return {"image": found["image"], "holds": holds, "start": start, "finish": finish,
            "climber_height_m": 1.75, "wall_height_m": wall_m, "wall_angle_deg": angle}


def solver_numbers(req):
    """The same 26 numbers the served grade model reads (see route.solve)."""
    m_per_px = req["wall_height_m"] / req["image"]["h"]
    unit = route.UNIT_M * req["climber_height_m"] / route.REF_HEIGHT_M
    pts = [(h["x"] * m_per_px / unit, (req["image"]["h"] - h["y"]) * m_per_px / unit) for h in req["holds"]]
    bad = {p: 1 - h["quality"] for p, h in zip(pts, req["holds"])}
    ids = [h["id"] for h in req["holds"]]
    s, e = [ids.index(i) for i in req["start"]], [ids.index(i) for i in req["finish"]]
    f = beta_solver.features(pts, s, e, bad, bad)
    f["angle"], f["n_foot_only"] = float(req["wall_angle_deg"]), 0
    return f


def physics_numbers(out):
    """A climb's physics in a few numbers, from the all-limbs /solve answer."""
    moves, frames = out["moves"], out["keyframes"]
    eff = [m["effort"] for m in moves] or [frames[0]["physics"]["effort"]]
    hand_share = [sum(f["share"] for f in k["physics"]["forces"] if f["limb"][1] == "H") for k in frames]
    return {"phys_effort_max": max(eff), "phys_effort_mean": float(np.mean(eff)),
            "phys_effort_top2": float(np.mean(sorted(eff)[-2:])),
            "phys_unstable": sum(not m["stable"] for m in moves),
            "phys_foot_moves": sum(m["limb"][1] == "F" for m in moves),
            "phys_hand_moves": sum(m["limb"][1] == "H" for m in moves),
            "phys_hand_share_max": max(hand_share), "phys_hand_share_mean": float(np.mean(hand_share))}


def v_of(font_grade):
    return int(next(v for f, v in route.GRADES.values() if f == font_grade).lstrip("V"))


def score(y, p):
    p = np.asarray(p, float)
    return {"mae_v": round(float(np.abs(p - y).mean()), 2), "within_1_v": round(float((np.abs(np.rint(p) - y) <= 1).mean()), 3),
            "exact": round(float((np.rint(p) == y).mean()), 3), "spearman": round(float(spearmanr(p, y).correlation), 3)}


def cross_val(X, y, splits, make):
    pred = np.zeros(len(y))
    for tr, te in splits:
        m = make().fit(X[tr], y[tr])
        pred[te] = m.predict(X[te])
    return pred


def main():
    wall_m = float(sys.argv[1]) if len(sys.argv) > 1 else 4.0
    angle = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
    rows, failed = [], []
    for p in problems():
        found = graded_holds.find_marked_holds(p["path"])
        if len(found["holds"]) < 2:
            failed.append((p["name"], "fewer than two marked holds found")); continue
        req = request(found, wall_m, angle)
        try:
            served = route.solve(dict(req, limbs="hands"))
            full = route.solve(req)
        except route.RouteError as e:
            failed.append((p["name"], str(e))); continue
        rows.append({**p, "n_holds": len(req["holds"]), "served_v": v_of(served["grade"]["font"]),
                     "solver": solver_numbers(req), "physics": physics_numbers(full)})
    y = np.array([r["v"] for r in rows], float)
    groups = [r["page"] for r in rows]
    S = np.array([[r["solver"][k] for k in sorted(r["solver"])] for r in rows], float)
    P = np.array([[r["physics"][k] for k in sorted(r["physics"])] for r in rows], float)
    served = np.array([r["served_v"] for r in rows], float)
    splits = {"random": list(KFold(5, shuffle=True, random_state=SEED).split(S)),
              "test": list(GroupKFold(5).split(S, y, groups))}
    ridge = lambda: make_pipeline(StandardScaler(), Ridge(alpha=10.0))
    line = lambda: Ridge(alpha=1e-3)
    results = {}
    for name, sp in splits.items():
        median = np.zeros(len(y))
        for tr, te in sp:
            median[te] = np.median(y[tr])
        results[name] = {
            "always guess the middle grade": score(y, median),
            "served model, as the app answers": score(y, served),
            "served model, rescaled to this wall": score(y, cross_val(served[:, None], y, sp, line)),
            "fitted here: solver numbers": score(y, cross_val(S, y, sp, ridge)),
            "fitted here: physics numbers": score(y, cross_val(P, y, sp, ridge)),
            "fitted here: solver + physics numbers": score(y, cross_val(np.hstack([S, P]), y, sp, ridge)),
            "fitted here: served grade + physics numbers": score(y, cross_val(np.hstack([served[:, None], P]), y, sp, ridge)),
        }
    out = {"wall": "The A spray wall, Minneapolis", "problems": len(rows), "pages": len(set(groups)),
           "could_not_use": failed, "assumed": {"wall_height_m": wall_m, "wall_angle_deg": angle, "hold_quality": 0.5,
                                                 "hold_type": "unknown", "climber_height_m": 1.75},
           "results": results,
           "per_problem": [{k: r[k] for k in ("name", "v", "page", "n_holds", "served_v")} for r in rows]}
    for name, rs in results.items():
        print(f"--- {name} split ({len(rows)} problems, {len(set(groups))} pages)")
        for model, sc in rs.items():
            print(f"  {model:48s} {sc}")
    print("could not use:", len(failed), failed[:5])
    tag = "" if (wall_m, angle) == (4.0, 0.0) else f"_{wall_m:g}m_{angle:g}deg"
    json.dump(out, open(os.path.join(HERE, f"results_graded{tag}.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
