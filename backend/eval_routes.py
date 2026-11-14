"""How well does a grouping method recover the labelled routes of a photo?

    .venv/bin/python eval_routes.py            # prints the tables, writes results_routes.json

Data: wall training images/indoor-bouldering-photos/annotations/holds-and-routes.json
(Tomáš Sláma, CC BY-SA 4.0). 19 photos have hold outlines; 8 of those also say
which route each hold belongs to. Only those 8 are scored.

What a method is given: the photo and every labelled hold in it (also the ones
with no route label; they are there to get in the way, as in real use).
What it returns: for every hold, the set of holds one click on it would select.

Two settings:
  boxes     each hold is only its bounding box (what the detector gives today)
  outlines  each hold also has its labelled shape (what a segmentation model would give)

Scores, counted over holds that have a route label:
  per labelled route: the best-matching predicted group's precision (share of
      the group that is in the route), recall (share of the route that is in
      the group) and F1 (one number that is high only when both are high)
  routes_found: share of labelled routes whose best group has F1 >= 0.8.
      This is the "one click picks the route" number.
  holds_right: share of holds that sit in a group matching their own route
      (F1 >= 0.8 between the group a click on that hold selects and the hold's
      route). Stricter than routes_found: every hold counts, not the best one.

The benchmark is small. Settings of routes.py are chosen leaving one photo out:
picked on seven photos, scored on the eighth, for each photo in turn. That
leave-one-out score is the headline.
"""
import itertools
import json
import os
import time

import numpy as np
from PIL import Image

import routes

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "wall training images", "indoor-bouldering-photos")
GOOD = 0.8


# ---------------------------------------------------------------- data

def load():
    """[{name, rgb, holds: [{x, y, w, h, outline, route}]}] for the photos that have route labels."""
    doc = json.load(open(os.path.join(DATA, "annotations", "holds-and-routes.json")))
    photos = []
    for im in doc["images"]:
        if not any(r["route_id"] is not None for r in im["regions"]):
            continue
        rgb = np.asarray(Image.open(os.path.join(DATA, im["image_path"])).convert("RGB"))
        holds = []
        for r in im["regions"]:
            poly = np.asarray(r["polygon_xy"], float)
            x0, y0 = poly.min(axis=0)
            x1, y1 = poly.max(axis=0)
            holds.append({"x": (x0 + x1) / 2, "y": (y0 + y1) / 2, "w": x1 - x0, "h": y1 - y0,
                          "outline": poly.tolist(), "route": r["route_id"], "kind": r["hold_type"]})
        photos.append({"name": im["image_path"], "rgb": rgb, "holds": holds})
    return photos


def as_setting(holds, setting):
    """The holds as a method sees them: no route label, and no outline in the "boxes" setting."""
    keep = ("x", "y", "w", "h", "outline") if setting == "outlines" else ("x", "y", "w", "h")
    return [{k: h[k] for k in keep} for h in holds]


# ---------------------------------------------------------------- today's behaviour (the baseline)

def baseline_color(arr, box):
    """analyze._color, copied: the most colourful pixels in the middle of the box."""
    h, w = arr.shape[:2]
    x0, y0, x1, y1 = (int(round(v)) for v in box)
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w), min(y1, h)
    mx, my = int(0.2 * (x1 - x0)), int(0.2 * (y1 - y0))
    inner = arr[y0 + my:max(y1 - my, y0 + my + 1), x0 + mx:max(x1 - mx, x0 + mx + 1)].reshape(-1, 3).astype(float)
    vivid = inner.max(axis=1) - inner.min(axis=1)
    r, g, b = np.median(inner[vivid >= np.percentile(vivid, 60)], axis=0)
    return "#%02x%02x%02x" % (int(r), int(g), int(b))


def _hsv(hex_colour):
    """The hsv() of demo/index.html, copied."""
    r, g, b = (int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5))
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    h = 0.0
    if d:
        if mx == r:
            h = float(np.fmod((g - b) / d, 6))      # JavaScript % keeps the sign, like fmod
        elif mx == g:
            h = (b - r) / d + 2
        else:
            h = (r - g) / d + 4
    return float(np.fmod(h * 60 + 360, 360)), (d / mx if mx else 0.0), mx


def same_colour(c1, c2):
    """The sameColour() of demo/index.html, copied."""
    h1, s1, v1 = _hsv(c1)
    h2, s2, v2 = _hsv(c2)
    if s1 < 0.2 and s2 < 0.2:
        return abs(v1 - v2) < 0.2
    if s1 < 0.2 or s2 < 0.2:
        return False
    dh = min(abs(h1 - h2), 360 - abs(h1 - h2))
    return dh < 16 and abs(v1 - v2) < 0.4


def _box(h):
    return (h["x"] - h["w"] / 2, h["y"] - h["h"] / 2, h["x"] + h["w"] / 2, h["y"] + h["h"] / 2)


def page_rule(hexes):
    """What one click selects on today's test page: every hold the hue rule calls the same colour."""
    return [frozenset(j for j, cj in enumerate(hexes) if same_colour(ci, cj)) for ci in hexes]


def groups_from_labels(labels):
    members = {}
    for i, lab in enumerate(labels):
        members.setdefault(lab, set()).add(i)
    return [frozenset(members[lab]) for lab in labels]


def hex_to_lab(hexes):
    arr = np.array([[[int(c[i:i + 2], 16) for i in (1, 3, 5)] for c in hexes]], np.uint8)
    return routes._lab(arr)[0]


def colours_today(rgb, holds):
    """Hex colour per hold, as analyze.py computes it today."""
    return [baseline_color(rgb, _box(h)) for h in holds]


def method_today(rgb, holds):
    """Today's behaviour: one colour per box, then the page's hue rule."""
    return page_rule(colours_today(rgb, holds))


def method_new(rgb, holds, params=None):
    """routes.py, through the function analyze.py will call."""
    per_hold, _ = routes.find_routes(rgb, holds, params)
    return groups_from_labels([("alone", i) if h["route"] is None else h["route"] for i, h in enumerate(per_hold)])


# ---------------------------------------------------------------- scoring

def score_photo(holds, groups):
    """holds carry "route"; groups[i] is the set of hold indices selected by a click on hold i."""
    labelled = [i for i, h in enumerate(holds) if h["route"] is not None]
    lab_set = set(labelled)
    true = {}
    for i in labelled:
        true.setdefault(holds[i]["route"], set()).add(i)
    # Only labelled holds count, so cut every group down to them.
    cut = [frozenset(g) & lab_set for g in groups]
    distinct = sorted({g for g in cut if g}, key=lambda g: sorted(g))

    def prf(group, route):
        hit = len(group & route)
        if hit == 0:
            return 0.0, 0.0, 0.0
        pr, rc = hit / len(group), hit / len(route)
        return pr, rc, 2 * pr * rc / (pr + rc)

    per_route = []
    for rid in sorted(true, key=lambda r: (len(str(r)), str(r))):
        route = true[rid]
        best = max((prf(g, route) for g in distinct), key=lambda t: t[2], default=(0.0, 0.0, 0.0))
        per_route.append({"route": rid, "holds": len(route), "precision": best[0], "recall": best[1], "f1": best[2]})

    holds_right = sum(prf(cut[i], true[holds[i]["route"]])[2] >= GOOD for i in labelled)
    return {"routes": len(true), "holds": len(labelled), "holds_in_photo": len(holds),
            "per_route": per_route, "holds_right": int(holds_right)}


def summarise(per_photo):
    """Totals over photos: every route counts once, every hold counts once."""
    rr = [r for s in per_photo for r in s["per_route"]]
    n_holds = sum(s["holds"] for s in per_photo)
    return {"routes": len(rr), "holds": n_holds,
            "precision": round(float(np.mean([r["precision"] for r in rr])), 3),
            "recall": round(float(np.mean([r["recall"] for r in rr])), 3),
            "f1": round(float(np.mean([r["f1"] for r in rr])), 3),
            "routes_found": round(float(np.mean([r["f1"] >= GOOD for r in rr])), 3),
            "holds_right": round(sum(s["holds_right"] for s in per_photo) / n_holds, 3),
            # Why the other routes were missed: the best group held only part of the route (split),
            # or also held holds of other routes (merged), or both.
            "missed_split": sum(r["f1"] < GOOD and r["precision"] >= GOOD for r in rr),
            "missed_merged": sum(r["f1"] < GOOD and r["precision"] < GOOD and r["recall"] >= GOOD for r in rr),
            "missed_both": sum(r["f1"] < GOOD and r["precision"] < GOOD and r["recall"] < GOOD for r in rr)}


# ---------------------------------------------------------------- running

GRID = {"grey_weight": [0.15, 0.3, 0.45], "limit": [6, 7, 8, 9, 10, 12], "far_weight": [1, 2, 3, 4]}
GRID_NO_POSITION = {"grey_weight": [0.15, 0.3, 0.45], "limit": [4, 5, 6, 7, 8, 9, 10, 12], "far_weight": [0]}


def shaken(holds, amount=0.15, seed=0):
    """Boxes as an imperfect detector might give them: every side moved by up to 15% of the box size."""
    rng = np.random.default_rng(seed)
    out = []
    for h in holds:
        x0, y0, x1, y1 = _box(h)
        dx0, dx1 = rng.uniform(-amount, amount, 2) * h["w"]
        dy0, dy1 = rng.uniform(-amount, amount, 2) * h["h"]
        x0, x1, y0, y1 = x0 + dx0, x1 + dx1, y0 + dy0, y1 + dy1
        out.append({"x": (x0 + x1) / 2, "y": (y0 + y1) / 2, "w": x1 - x0, "h": y1 - y0})
    return out


def _objective(score):
    """What settings are picked by: summed F1 over routes, plus a quarter point for each route found."""
    return sum(r["f1"] for r in score["per_route"]) + 0.25 * sum(r["f1"] >= GOOD for r in score["per_route"])


def leave_one_out(photos, colours, seen, grid):
    """colours[i]: Lab colour per hold of photo i. seen[i]: the holds of photo i as the method sees them.
    For each photo: pick the grid point that scores best on the other photos, score it on this one.
    Returns (per-photo scores, the settings picked for each photo, the settings that are best on all photos)."""
    keys = list(grid)
    combos = [dict(zip(keys, c)) for c in itertools.product(*(grid[k] for k in keys))]
    table = [[score_photo(p["holds"], groups_from_labels(routes.group(col, hs, combo).tolist()))
              for p, col, hs in zip(photos, colours, seen)] for combo in combos]
    obj = np.array([[_objective(s) for s in row] for row in table])
    scores, picks = [], []
    for i in range(len(photos)):
        best = int(np.argmax(np.delete(obj, i, axis=1).sum(axis=1)))
        scores.append(table[best][i])
        picks.append(combos[best])
    return scores, picks, combos[int(np.argmax(obj.sum(axis=1)))]


def _timing(photo):
    """Seconds for find_routes on 200 holds of one 1920-pixel photo: the middle of five runs."""
    out = {}
    for setting in ("boxes", "outlines"):
        holds = as_setting(photo["holds"], setting)[:200]
        runs = []
        for _ in range(5):
            t = time.perf_counter()
            routes.find_routes(photo["rgb"], holds)
            runs.append(time.perf_counter() - t)
        out[setting] = {"holds": len(holds), "photo_px": list(photo["rgb"].shape[1::-1]), "seconds": round(sorted(runs)[2], 3)}
    return out


def main():
    photos = load()
    results = {
        "what": "How well grouping recovers the labelled routes of a photo. See eval_routes.py for the definitions.",
        "data": {"photos": len(photos), "names": [p["name"] for p in photos],
                 "routes": sum(len({h["route"] for h in p["holds"]} - {None}) for p in photos),
                 "holds_with_a_route": sum(h["route"] is not None for p in photos for h in p["holds"]),
                 "holds_in_those_photos": sum(len(p["holds"]) for p in photos)},
        "good_match_is_f1_at_least": GOOD,
        "shipped_settings": {k: routes.PARAMS[k] for k in ("grey_weight", "limit", "far_weight")},
        "rows": [], "per_photo": {}, "leave_one_out_picks": {},
    }

    def add(name, setting, tuned, per_photo, note=""):
        row = dict({"method": name, "setting": setting, "settings_chosen": tuned}, **summarise(per_photo))
        if note:
            row["note"] = note
        results["rows"].append(row)
        results["per_photo"][name + " | " + setting] = [dict({"photo": p["name"]}, **summarise([s])) for p, s in zip(photos, per_photo)]
        print("%-42s %-9s %-14s  P %.2f  R %.2f  F1 %.2f   routes found %3.0f%%   holds right %3.0f%%" % (
            name, setting, tuned, row["precision"], row["recall"], row["f1"], 100 * row["routes_found"], 100 * row["holds_right"]))
        return row

    print("%d photos, %d labelled routes, %d holds with a route label (%d holds in those photos)\n" % (
        results["data"]["photos"], results["data"]["routes"], results["data"]["holds_with_a_route"],
        results["data"]["holds_in_those_photos"]))

    best_on_all = {}
    for setting in ("boxes", "outlines"):
        seen = [as_setting(p["holds"], setting) for p in photos]
        old_hex = [colours_today(p["rgb"], hs) for p, hs in zip(photos, seen)]
        old_lab = [hex_to_lab(hx) for hx in old_hex]
        new_lab = [routes.hold_colours(p["rgb"], hs) for p, hs in zip(photos, seen)]
        score = lambda groups: [score_photo(p["holds"], g) for p, g in zip(photos, groups)]

        add("today (analyze._color + page hue rule)", setting, "fixed", score([page_rule(hx) for hx in old_hex]),
            "does not use outlines, so both settings are the same")
        add("new colour, page hue rule", setting, "fixed",
            score([page_rule([routes.lab_to_hex(c) for c in col]) for col in new_lab]))
        s, _, _ = leave_one_out(photos, old_lab, seen, GRID)
        add("today's colour, new grouping", setting, "leave-one-out", s)
        s, _, _ = leave_one_out(photos, new_lab, seen, GRID_NO_POSITION)
        add("new, colour only (position not used)", setting, "leave-one-out", s)
        s, picks, best = leave_one_out(photos, new_lab, seen, GRID)
        add("new (routes.py)", setting, "leave-one-out", s, "the headline row")
        results["leave_one_out_picks"][setting] = [dict({"photo_left_out": p["name"]}, **pk) for p, pk in zip(photos, picks)]
        best_on_all[setting] = best
        add("new (routes.py)", setting, "as shipped", score([method_new(p["rgb"], hs) for p, hs in zip(photos, seen)]),
            "settings were chosen with these photos in view, so this is a little flattering")
        if setting == "boxes":
            add("new (routes.py), boxes shaken by 15%", setting, "as shipped",
                score([method_new(p["rgb"], shaken(hs)) for p, hs in zip(photos, seen)]),
                "every box side moved at random by up to 15% of the box, to imitate a detector")
            add("today, boxes shaken by 15%", setting, "fixed",
                score([method_today(p["rgb"], shaken(hs)) for p, hs in zip(photos, seen)]))
        print()

    results["best_settings_on_all_photos"] = best_on_all
    results["timing"] = _timing(max(photos, key=lambda p: len(p["holds"])))
    print("best settings on all eight photos:", best_on_all)
    print("shipped settings:", results["shipped_settings"])
    print("time for find_routes:", results["timing"])
    json.dump(results, open(os.path.join(HERE, "results_routes.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
