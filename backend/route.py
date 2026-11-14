"""POST /solve: a chosen route in photo pixels in, moves, poses and a grade out.

Climber height works by scaling the wall, not the climber. The solver's reach
is fixed for a 1.75 m person; for someone shorter the same wall is measured in
smaller units, so every span is longer for them. Sequence, load and grade all
change with height from that one step.
"""
import functools
import json
import os

import numpy as np

import beta_solver
import pose

HERE = os.path.dirname(os.path.abspath(__file__))
UNIT_M = 0.2             # one solver grid unit, for the reference climber
REF_HEIGHT_M = 1.75
LOAD_FULL_SCALE = 30.0   # solver move cost that is reported as load 1.0

# Kilter difficulty number -> (Font, V).
GRADES = {10: ("4a", "V0"), 11: ("4b", "V0"), 12: ("4c", "V0"), 13: ("5a", "V1"), 14: ("5b", "V1"),
          15: ("5c", "V2"), 16: ("6a", "V3"), 17: ("6a+", "V3"), 18: ("6b", "V4"), 19: ("6b+", "V4"),
          20: ("6c", "V5"), 21: ("6c+", "V5"), 22: ("7a", "V6"), 23: ("7a+", "V7"), 24: ("7b", "V8"),
          25: ("7b+", "V8"), 26: ("7c", "V9"), 27: ("7c+", "V10"), 28: ("8a", "V11"), 29: ("8a+", "V12"),
          30: ("8b", "V13"), 31: ("8b+", "V14")}


class RouteError(ValueError):
    """The request cannot be solved; the message is safe to show the user."""


@functools.lru_cache(maxsize=1)
def _models():
    # Imported here, not at the top: LightGBM and PyTorch each ship their own OpenMP
    # library and crash the process if both are used in it (macOS). The server runs
    # this module in a separate worker process that never loads PyTorch.
    import lightgbm as lgb
    meta = json.load(open(os.path.join(HERE, "models", "grade_meta.json")))
    load = lambda name: lgb.Booster(model_file=os.path.join(HERE, "models", name))
    return meta["features"], load("grade.txt"), load("grade_low.txt"), load("grade_high.txt")


def _grade(features):
    cols, mid, low, high = _models()
    x = np.array([[features[c] for c in cols]], dtype=float)
    name = lambda v: GRADES[int(np.clip(round(float(v)), 10, 31))]
    m, lo, hi = float(mid.predict(x)[0]), float(low.predict(x)[0]), float(high.predict(x)[0])
    lo, hi = min(lo, m), max(hi, m)
    return {"font": name(m)[0], "v": name(m)[1], "low": name(lo)[0], "high": name(hi)[0]}


def warm():
    _models()


def solve(req):
    """req: the POST /solve body as a dict. Returns the response dict."""
    image_h = req["image"]["h"]
    holds = req["holds"]
    ids = [h["id"] for h in holds]
    if len(set(ids)) != len(ids):
        raise RouteError("Two holds share the same id.")
    start, finish = list(req["start"]), list(req["finish"])
    if not start or not finish:
        raise RouteError("Mark at least one start hold and one finish hold.")
    missing = [i for i in start + finish if i not in ids]
    if missing:
        raise RouteError(f"Start or finish hold {missing[0]} is not in the hold list.")

    m_per_px = req["wall_height_m"] / image_h
    unit_m = UNIT_M * req["climber_height_m"] / REF_HEIGHT_M
    to_units = lambda h: (h["x"] * m_per_px / unit_m, (image_h - h["y"]) * m_per_px / unit_m)

    # Hands may use every hold except foot-only ones (unless one was marked start or finish).
    hand = [h for h in holds if h.get("type") != "foot" or h["id"] in start or h["id"] in finish]
    pts = [to_units(h) for h in hand]
    bad = {p: 1.0 - float(h.get("quality", 0.5)) for p, h in zip(pts, hand)}
    idx = {h["id"]: i for i, h in enumerate(hand)}
    s_idx, e_idx = [idx[i] for i in start], [idx[i] for i in finish]

    moves = beta_solver.solve(pts, s_idx, e_idx, bad, bad)
    if moves is None:
        raise RouteError("No sequence found: at least one move is further than this climber can reach. "
                         "Add the holds in between, or check the wall height.")

    if len(s_idx) >= 2:
        state = tuple(sorted(s_idx[:2], key=lambda i: pts[i][0]))
    else:
        state = (s_idx[0], s_idx[0])
    states = [state] + [m["state"] for m in moves]

    out_moves = [{"i": i, "limb": "LH" if m["hand"] == 0 else "RH", "hold": hand[m["to"]]["id"],
                  "load": round(min(m["cost"] / LOAD_FULL_SCALE, 1.0), 2),
                  "span_m": round(m["span"] * unit_m, 2)} for i, m in enumerate(moves)]
    crux = max(range(len(moves)), key=lambda i: moves[i]["cost"]) if moves else 0

    feats = beta_solver.features(pts, s_idx, e_idx, bad, bad)
    feats["angle"] = float(req.get("wall_angle_deg", 0))
    feats["n_foot_only"] = len(holds) - len(hand)

    # Poses use every route hold (feet included), in pixels.
    pos = {h["id"]: i for i, h in enumerate(holds)}
    px_states = [(pos[hand[a]["id"]], pos[hand[b]["id"]]) for a, b in states]
    frames = pose.keyframes([(h["x"], h["y"]) for h in holds], [h.get("w", 0) for h in holds],
                            px_states, req["climber_height_m"] / m_per_px, image_h)
    return {"grade": _grade(feats), "crux": crux, "moves": out_moves, "keyframes": frames}
