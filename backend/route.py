"""POST /solve: a chosen route in photo pixels in, moves, poses and a grade out.

Climber height works by scaling the wall, not the climber. The solver's reach
is fixed for a 1.75 m person; for someone shorter the same wall is measured in
smaller units, so every span is longer for them. Sequence, load and grade all
change with height from that one step.

Two kinds of answer, chosen by the request's optional "limbs" field:

- "hands": the hand sequence only, with a figure drawn under the hands
  (pose.keyframes). This is the original answer, unchanged.
- "all" (the default): the same hand sequence with foot moves added
  (limbs.plan), every pose built from the holds the limbs are on, and the
  forces on each limb from the statics model (physics.py).

The grade is the same in both: it comes from the hand sequence alone. The
physics is not fed into it yet; physics_features() is there to test whether it
should be.
"""
import functools
import json
import math
import os

import numpy as np

import beta_solver
import limbs
import physics
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
    mode = req.get("limbs") or "all"
    if mode not in ("all", "hands"):
        raise RouteError('"limbs" must be "all" (hands and feet) or "hands".')
    image_h = req["image"]["h"]
    holds = req["holds"]
    ids = [h["id"] for h in holds]
    if len(set(ids)) != len(ids):
        raise RouteError("Two holds share the same id.")
    # Repeated ids are dropped: the grade model counts start and finish holds.
    start, finish = list(dict.fromkeys(req["start"])), list(dict.fromkeys(req["finish"]))
    if not start or not finish:
        raise RouteError("Mark at least one start hold and one finish hold.")
    if len(start) > 2:
        raise RouteError("Mark one or two start holds: one for each hand.")
    if set(start) & set(finish):
        raise RouteError("A hold cannot be both a start and a finish hold.")
    missing = [i for i in start + finish if i not in ids]
    if missing:
        raise RouteError(f"Start or finish hold {missing[0]} is not in the hold list.")

    m_per_px = req["wall_height_m"] / image_h
    if len(start) == 2:
        a, b = (next(h for h in holds if h["id"] == i) for i in start)
        if math.hypot(a["x"] - b["x"], a["y"] - b["y"]) * m_per_px > 2 * pose.ARM * req["climber_height_m"]:
            raise RouteError("The two start holds are too far apart for this climber to hold both. "
                             "Pick start holds closer together, or check the wall height.")
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
    grade = _grade(feats)

    # Poses use every route hold (feet included), in pixels.
    pos = {h["id"]: i for i, h in enumerate(holds)}
    px_states = [(pos[hand[a]["id"]], pos[hand[b]["id"]]) for a, b in states]
    height_px = req["climber_height_m"] / m_per_px
    if mode == "hands":
        frames = pose.keyframes([(h["x"], h["y"]) for h in holds], [h.get("w", 0) for h in holds],
                                px_states, height_px, image_h)
        return {"grade": grade, "crux": crux, "moves": out_moves, "keyframes": frames}

    # All four limbs. A climb is finished with both hands on the top hold, so if the search
    # ended with one hand there, the other hand matches it as a last move.
    last = states[-1]
    if last[0] != last[1] and (last[0] in e_idx or last[1] in e_idx):
        top = last[0] if last[0] in e_idx else last[1]
        hand_moving = 1 if last[0] == top else 0          # 0 = left hand
        other = last[hand_moving]
        span = math.dist(pts[other], pts[top])
        states = states + [(top, top)]
        px_states = px_states + [(pos[hand[top]["id"]],) * 2]
        out_moves = out_moves + [{"i": len(out_moves), "limb": "LH" if hand_moving == 0 else "RH", "hold": hand[top]["id"],
                                  "load": round(min(0.5 * (span + 0.5) / LOAD_FULL_SCALE, 1.0), 2), "span_m": round(span * unit_m, 2)}]

    # Everything below works in solver units with y up, then goes back to pixels.
    px_per_unit = unit_m / m_per_px
    plan = limbs.plan([to_units(h) for h in holds], px_states,
                      kinds=[h.get("type") or "unknown" for h in holds],
                      quality_left=[float(h.get("quality", 0.5)) for h in holds],
                      widths=[h.get("w", 0) / px_per_unit for h in holds],
                      angle_deg=float(req.get("wall_angle_deg", 0)),
                      body_out=physics.BODY_OUT_M / unit_m,
                      floor=2 / px_per_unit)             # the bottom edge of the photo is taken to be the floor
    to_px = lambda p: (p[0] * px_per_unit, image_h - p[1] * px_per_unit)
    hold_id = lambda i: None if i is None else holds[i]["id"]

    def limb_px(frame, limb):
        """Where this limb is drawn: exactly on its hold's centre when it is on one."""
        i = frame["contacts"][limb]
        if i is None:
            return to_px(frame["points"][limb])
        x, y = holds[i]["x"], holds[i]["y"]
        if limb[1] == "H" and frame["contacts"]["LH"] == frame["contacts"]["RH"]:    # two hands side by side
            off = min(holds[i].get("w", 0) / 4, limbs.MATCH_OFFSET * height_px)
            x += off if limb == "RH" else -off
        return (x, y)

    keyframes = []
    for k, frame in enumerate(plan["frames"]):
        at = {limb: limb_px(frame, limb) for limb in ("LH", "RH", "LF", "RF")}
        joints = pose.figure(to_px(frame["neck"]), at["LH"], at["RH"], at["LF"], at["RF"], height_px)
        result = frame["physics"]
        com = to_px(frame["com"])
        effort = round(result.effort, 3)
        forces = [{"limb": limb, "at": joints[limb.lower()], "f": [round(fx, 3) + 0.0, round(fy, 3) + 0.0], "share": round(share, 3)}   # + 0.0 turns -0.0 into 0.0
                  for limb, (fx, fy, share) in result.photo_forces().items()]
        keyframes.append({"move": k, "joints": joints,
                          "contacts": {limb: hold_id(i) for limb, i in frame["contacts"].items()},
                          "physics": {"com": [round(com[0]), round(com[1])], "effort": effort,
                                      "stable": bool(result.balanced and effort < 1.0), "forces": forces}})

    moves = []
    for i, (m, frame) in enumerate(zip(plan["moves"], plan["frames"][1:])):
        effort = round(m["effort"], 3)
        if m["hand_move"] is not None:
            move = dict(out_moves[m["hand_move"]], i=i)
        else:
            # A foot move has no entry in the hand solver. Its load is its effort (at most 1);
            # its span is how far apart the two feet are afterwards.
            move = {"i": i, "limb": m["limb"], "hold": hold_id(m["hold"]), "load": round(min(effort, 1.0), 2),
                    "span_m": round(math.dist(frame["points"]["LF"], frame["points"]["RF"]) * unit_m, 2)}
        move["effort"] = effort
        move["stable"] = bool(m["balanced"] and effort < 1.0)
        moves.append(move)
    # The hardest move stays the one the hand solver found hardest, at its new place in the list.
    crux = next((i for i, m in enumerate(plan["moves"]) if m["hand_move"] == crux), 0)
    efforts = [m["effort"] for m in moves] or [keyframes[0]["physics"]["effort"]]
    summary = {"model": "static-2.5d", "max_effort": max(efforts),
               "mean_effort": round(sum(efforts) / len(efforts), 3),
               "unstable_positions": sum(1 for m in moves if not m["stable"])}
    return {"grade": grade, "crux": crux, "moves": moves, "keyframes": keyframes, "physics": summary}


def physics_features(holds, start_idx, end_idx, bad_left, bad_right=None, angle_deg=0.0, foot_holds=(),
                     kinds=None, floor=None):
    """Numbers that sum up the physics of one climb, for the grade experiments. No photo needed.

    holds, start_idx, end_idx, bad_left, bad_right: exactly what beta_solver.solve() and
        beta_solver.features() take: hand holds as (x, y) in solver units with y up, and
        hold badness 0..1 keyed by (x, y) (missing holds count as 0.5).
    angle_deg: overhang of the wall. foot_holds: [(x, y)] holds only feet may use.
    kinds: hold type of each hand hold if known (see physics.HAND); default "unknown".
    floor: height of the floor in solver units; None for a board with no floor to stand on.
    Returns a dict with the keys in limbs.FEATURES, always the same ones; every value is -1
    (and phys_solved 0) when the hand solver finds no sequence.
    """
    bad_right = bad_left if bad_right is None else bad_right
    moves = beta_solver.solve(holds, start_idx, end_idx, bad_left, bad_right)
    if not moves:
        return limbs.features(None)
    if len(start_idx) >= 2:
        state = tuple(sorted(start_idx[:2], key=lambda i: holds[i][0]))
    else:
        state = (start_idx[0], start_idx[0])
    states = [state] + [m["state"] for m in moves]
    feet = [tuple(f) for f in foot_holds]
    plan = limbs.plan(list(holds) + feet, states,
                      kinds=(list(kinds) if kinds is not None else ["unknown"] * len(holds)) + ["foot"] * len(feet),
                      quality_left=[1.0 - bad_left.get(tuple(h), 0.5) for h in holds] + [0.1] * len(feet),
                      quality_right=[1.0 - bad_right.get(tuple(h), 0.5) for h in holds] + [0.1] * len(feet),
                      angle_deg=float(angle_deg), floor=floor)
    return limbs.features(plan)
