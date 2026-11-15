"""Climbs recorded by the app's live camera: saved, found again, and used for training.

Every climb the live camera follows is sent to POST /climbs and kept here as one JSON file in
data/climbs/ (gitignored: these are real people's climbs). Each climb is used two ways:

  1. Found again (retrieval). POST /climbs/similar takes a /solve request and returns the stored
     climbs on the most similar routes: how high they were, how far apart the holds were, which
     hold types. The coach can tell the climber what people did on routes like this one.
  2. Training. to_training() turns a climb into exactly the shape wayup.climbs() gives for The Way
     Up's 22 recorded climbs, so train_physics.py tunes the physics on both:
         ASCEND_CLIMBS=1 python3 train_physics.py
     A tuned setting still ships only if it wins on the random split and the held-out-route split.

A record (what the app sends):
  {"image": {"w", "h"}, "wall_height_m", "climber_height_m", "strength",
   "holds": [{"id", "x", "y", "w", "h", "type"}]   the route's holds, photo pixels,
   "start": [ids], "finish": [ids],
   "events": [{"t": ms from the start, "limb": "LH"|"RH"|"LF"|"RF", "hold": id or null}],
   "planned": [{"limb", "hold"}]                    the moves the app suggested,
   "topped": bool, "source": "camera" | "video", "years": climbing experience (optional)}

Seen from behind, the pose model can swap left and right, so "same hand" scores on these climbs
are less reliable than the hold sets and their order.
"""
import json
import math
import os
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "data", "climbs")
LIMBS = ("LH", "RH", "LF", "RF")


class BadClimb(ValueError):
    pass


def _check(rec):
    try:
        ids = {int(h["id"]) for h in rec["holds"]}
        if rec["image"]["w"] <= 0 or rec["image"]["h"] <= 0 or not ids:
            raise BadClimb("The climb has no holds or no photo size.")
        if not 1.4 <= float(rec.get("climber_height_m", 1.75)) <= 2.1:
            raise BadClimb("climber_height_m must be 1.40 to 2.10.")
        for e in rec.get("events", []):
            if e["limb"] not in LIMBS or (e["hold"] is not None and int(e["hold"]) not in ids):
                raise BadClimb("An event names a limb or hold that is not on the route.")
    except (KeyError, TypeError) as e:
        raise BadClimb(f"The climb is missing a field: {e}")


def save(rec):
    """Store one recorded climb. Returns its id."""
    _check(rec)
    os.makedirs(DIR, exist_ok=True)
    cid = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    rec = dict(rec, id=cid, saved_at=time.time())
    with open(os.path.join(DIR, cid + ".json"), "w") as f:
        json.dump(rec, f)
    return cid


def load_all():
    if not os.path.isdir(DIR):
        return []
    out = []
    for name in sorted(os.listdir(DIR)):
        if name.endswith(".json"):
            try:
                out.append(json.load(open(os.path.join(DIR, name))))
            except (OSError, ValueError):
                pass
    return out


def summary(rec):
    hands = [e for e in rec.get("events", []) if e["limb"][1] == "H" and e["hold"] is not None]
    return {"id": rec["id"], "saved_at": rec.get("saved_at"), "climber_height_m": rec.get("climber_height_m"),
            "strength": rec.get("strength"), "topped": bool(rec.get("topped")), "holds": len(rec["holds"]),
            "hand_moves": len(hands), "seconds": round(max([e["t"] for e in rec.get("events", [])] or [0]) / 1000, 1),
            "source": rec.get("source")}


# ---- training: The Way Up's shape -----------------------------------------------------------

def to_training(rec):
    """The climb as wayup.climbs() gives one: holds in metres (y up), events, hand order."""
    H = rec["image"]["h"]
    m = float(rec.get("wall_height_m", 4.0)) / H
    holds, index = [], {}
    for i, h in enumerate(rec["holds"]):
        index[int(h["id"])] = i
        holds.append({"x": h["x"] * m, "y": (H - h["y"]) * m, "w": h.get("w", 0) * m, "h": h.get("h", 0) * m,
                      "foot_only": h.get("type") == "foot"})
    events = sorted((int(e["t"]), e["limb"], None if e["hold"] is None else index[int(e["hold"])])
                    for e in rec.get("events", []))
    hands, last = [], {}
    for _, limb, hold in events:
        if limb[1] == "H" and hold is not None and last.get(limb) != hold:
            hands.append((limb, hold))
            last[limb] = hold
    years = float(rec.get("years", 1))
    return {"id": "ascend-" + rec["id"], "person": rec.get("person", "ascend"), "route": "ascend-" + _route_key(rec),
            "height_m": float(rec.get("climber_height_m", 1.75)), "years": years, "expert": years >= 5,
            "holds": holds, "events": events, "hands": hands}


def training_climbs():
    """Stored climbs usable for training: at least two hand moves onto holds."""
    out = []
    for rec in load_all():
        c = to_training(rec)
        if len(c["hands"]) >= 3:
            out.append(c)
    return out


def _route_key(rec):
    ids = sorted(int(h["id"]) for h in rec["holds"])
    return f"{rec['image']['w']}x{rec['image']['h']}-" + "-".join(map(str, ids[:6]))


# ---- retrieval: routes like this one --------------------------------------------------------

_KINDS = ("jug", "crimp", "sloper", "pinch", "pocket", "volume", "foot")


def route_features(holds, image_h, wall_height_m, climber_height_m):
    """A few numbers that describe a route for this climber: sizes in body heights."""
    m = wall_height_m / image_h / climber_height_m
    pts = [(h["x"] * m, (image_h - h["y"]) * m) for h in holds]
    ys = [p[1] for p in pts]
    gaps = []
    for i, p in enumerate(pts):
        d = [math.dist(p, q) for j, q in enumerate(pts) if j != i]
        if d:
            gaps.append(min(d))
    n = max(len(holds), 1)
    kinds = [sum(h.get("type") == k for h in holds) / n for k in _KINDS]
    return [len(holds) / 20, max(ys) - min(ys), sum(gaps) / max(len(gaps), 1), min(ys)] + kinds


def similar(req, k=3):
    """The stored climbs on routes most like the one in this /solve request, nearest first."""
    q = route_features(req["holds"], req["image"]["h"], req.get("wall_height_m", 4.0), req.get("climber_height_m", 1.75))
    rows = []
    for rec in load_all():
        f = route_features(rec["holds"], rec["image"]["h"], rec.get("wall_height_m", 4.0), rec.get("climber_height_m", 1.75))
        rows.append((math.dist(q, f), rec))
    rows.sort(key=lambda r: r[0])
    return [dict(summary(rec), distance=round(d, 3), what_they_did=_story(rec)) for d, rec in rows[:k]]


def _story(rec):
    """One plain sentence about the climb, for the coach to use."""
    s = summary(rec)
    who = f"A {s['climber_height_m']:.2f} m climber"
    end = "topped it" if s["topped"] else "did not top it"
    return f"{who} {end} in {s['hand_moves']} hand moves and {s['seconds']:.0f} seconds."
