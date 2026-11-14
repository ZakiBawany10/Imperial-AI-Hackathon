"""Hold colours and routes: which holds in a photo belong together.

Gyms mark each route (one climb) by giving all of its holds one colour. This
module looks at a photo and its holds and answers three things for each hold:
its colour (hex), a plain word for that colour, and which route it is part of.

    per_hold, routes = find_routes(rgb, holds)

How it works:

1. Colour of one hold. Only pixels that belong to the hold are used. With an
   outline, those are the pixels inside it. With only a box, the band of wall
   just outside the box shows what the wall looks like there, and a pixel inside
   the box is kept when it looks more like the middle of the box than like that
   wall. Chalk dust, shadow and bolt holes are the dullest pixels of a coloured
   hold, so the colour is read from the more colourful half.
2. Comparing two holds. Colours are compared in Lab, a colour space in which
   equal distances look like equal differences to a person. Two changes make it
   fit a dim gym: strong colours are squeezed together (a brightly lit and a
   shaded orange hold differ a lot in raw numbers but are the same orange), and
   brightness is only used between holds that have almost no colour, where it is
   the one thing that tells white, grey and black apart.
3. Grouping, per photo. Every hold starts alone. The two closest groups are
   joined, again and again, until no two groups are close enough. "Close" is the
   average colour difference between the two groups plus a charge for the empty
   wall between them (measured between their two nearest holds, in hold sizes).
   So nearby holds of nearly one colour join easily, and two routes of one
   colour on different parts of the wall stay apart. Nothing is a fixed colour
   table, so a dim photo and a bright photo are treated alike.
4. Names. Each route gets a plain colour word from its typical colour.

Measured by eval_routes.py; numbers are in results_routes.json.
Needs numpy and OpenCV only. No torch.
"""
import numpy as np
import cv2

PARAMS = {
    # Reading a hold's colour.
    "sample": 28,            # a hold is looked at on a grid of about this many pixels across
    "ring": 0.25,            # box only: width of the band of wall read around the box, as a share of the box
    # Comparing two holds. squeeze and grey_fade were set once from all labelled holds; they are not tuned further.
    "squeeze": 10.0,         # colour strength above about this is squeezed (log scale)
    "grey_fade": 15.0,       # brightness stops counting as a hold's colour strength passes about this
    "grey_weight": 0.3,      # tuned: how much brightness counts between two colourless holds
    # Grouping. Tuned by eval_routes.py, each time on seven photos and scored on the eighth.
    "limit": 8.0,            # tuned: groups are joined while closer than this
    "far_weight": 2.0,       # tuned: the charge for empty wall between two groups
    # Output.
    "min_route_holds": 2,    # a hold with no partner is left without a route
}


# ---------------------------------------------------------------- colour of one hold

def _lab(rgb):
    """The photo in Lab: L 0..100 (dark to bright), a (green to red), b (blue to yellow)."""
    rgb = np.asarray(rgb)
    if rgb.ndim == 2:
        rgb = np.stack([rgb] * 3, axis=-1)
    lab = cv2.cvtColor(np.ascontiguousarray(rgb[:, :, :3], dtype=np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    lab[:, :, 0] *= 100.0 / 255.0
    lab[:, :, 1:] -= 128.0
    return lab


def _hold_pixels(lab, hold, p):
    """Lab values of the pixels believed to be the hold itself, as an (n, 3) array."""
    H, W = lab.shape[:2]
    w, h = max(float(hold["w"]), 1.0), max(float(hold["h"]), 1.0)
    x0, y0, x1, y1 = hold["x"] - w / 2.0, hold["y"] - h / 2.0, hold["x"] + w / 2.0, hold["y"] + h / 2.0
    step = max(1, int(np.ceil(max(w, h) / p["sample"])))
    outline = hold.get("outline")

    if outline is not None and len(outline) >= 3:
        ix0, iy0 = max(int(np.floor(x0)), 0), max(int(np.floor(y0)), 0)
        ix1, iy1 = min(int(np.ceil(x1)), W), min(int(np.ceil(y1)), H)
        crop = lab[iy0:iy1:step, ix0:ix1:step]
        if crop.size:
            mask = np.zeros(crop.shape[:2], np.uint8)
            pts = (np.asarray(outline, np.float32) - [ix0, iy0]) / step
            cv2.fillPoly(mask, [np.round(pts).astype(np.int32)], 1)
            if mask.sum() > 60:                        # big enough: drop the rim, where wall and shadow leak in
                inner = cv2.erode(mask, np.ones((3, 3), np.uint8))
                if inner.sum() >= 20:
                    mask = inner
            px = crop[mask.astype(bool)]
            if len(px) >= 4:
                return px

    # Box only. Look at a slightly larger window: the band outside the box is wall.
    mx, my = p["ring"] * w + step, p["ring"] * h + step
    ex0, ey0 = max(int(np.floor(x0 - mx)), 0), max(int(np.floor(y0 - my)), 0)
    ex1, ey1 = min(int(np.ceil(x1 + mx)), W), min(int(np.ceil(y1 + my)), H)
    crop = lab[ey0:ey1:step, ex0:ex1:step]
    if crop.size == 0:                                 # the box is entirely off the photo
        return np.zeros((1, 3), np.float32)
    ys = ey0 + step * np.arange(crop.shape[0])[:, None]
    xs = ex0 + step * np.arange(crop.shape[1])[None, :]
    inside = (ys >= y0) & (ys < y1) & (xs >= x0) & (xs < x1)
    # How far each pixel is from the box centre: 0 at the centre, 1 at the box edge.
    r = np.maximum(np.abs(xs - hold["x"]) / (w / 2.0), np.abs(ys - hold["y"]) / (h / 2.0))
    box_px = crop[inside]
    if len(box_px) < 4:
        return box_px if len(box_px) else crop.reshape(-1, 3)
    wall_px = crop[~inside]
    core_px = crop[r <= 0.45]
    if len(wall_px) < 4 or len(core_px) < 2:
        return box_px
    wall = np.median(wall_px, axis=0)
    core = np.median(core_px, axis=0)
    keep = None
    for _ in range(2):                                 # keep what looks like the middle, then re-read the middle
        keep = ((box_px - core) ** 2).sum(axis=1) < ((box_px - wall) ** 2).sum(axis=1)
        if keep.sum() < max(4, 0.08 * len(box_px)):
            return core_px
        core = np.median(box_px[keep], axis=0)
    return box_px[keep]


def _colour_of(px):
    """One Lab colour for a hold from its pixels: the middle value of its more colourful half."""
    if len(px) >= 8:
        strength = np.hypot(px[:, 1], px[:, 2])
        px = px[strength >= np.median(strength)]
    return np.median(px, axis=0)


def hold_colours(rgb, holds, params=None):
    """Lab colour of each hold, as an (n, 3) array. rgb: the photo, height x width x 3, 0..255."""
    p = dict(PARAMS, **(params or {}))
    lab = _lab(rgb)
    out = np.zeros((len(holds), 3), np.float32)
    for i, h in enumerate(holds):
        out[i] = _colour_of(_hold_pixels(lab, h, p))
    return out


# ---------------------------------------------------------------- naming a colour

def lab_to_hex(c):
    lab = np.array([[[c[0] * 255.0 / 100.0, c[1] + 128.0, c[2] + 128.0]]], np.float32)
    r, g, b = cv2.cvtColor(np.clip(np.round(lab), 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)[0, 0]
    return "#%02x%02x%02x" % (int(r), int(g), int(b))


def colour_name(c):
    """A plain word for a Lab colour: black, grey, white, red, orange, yellow, green, blue, purple, pink or brown."""
    L, a, b = float(c[0]), float(c[1]), float(c[2])
    strength = float(np.hypot(a, b))
    if strength < 5.0 + 0.11 * L:                      # a bright hold picks up more of the room's light, so allow it more tint
        return "black" if L < 28 else "white" if L > 62 else "grey"
    hue = float(np.degrees(np.arctan2(b, a))) % 360.0  # about: 30 red, 55 orange, 90 yellow, 140 green, 260 blue, 310 purple
    if hue < 15 or hue >= 330:
        return "pink" if L >= 45 else "purple"
    if hue < 40:
        return "red"
    if hue < 68:
        return "brown" if L < 30 else "orange"
    if hue < 108:
        return "brown" if L < 30 else "yellow"
    if hue < 185:
        return "green"
    if hue < 290:
        return "blue"
    return "purple"


# ---------------------------------------------------------------- grouping

def _features(colours, p):
    """Each hold's colour as a point; straight-line distance between two points is how different the holds look."""
    c = np.asarray(colours, float).reshape(-1, 3)
    strength = np.hypot(c[:, 1], c[:, 2])
    squeeze = np.log1p(strength / p["squeeze"]) * p["squeeze"] / np.maximum(strength, 1e-6)
    grey = p["grey_weight"] * np.exp(-strength / p["grey_fade"]) * (c[:, 0] - 50.0)
    return np.c_[c[:, 1] * squeeze, c[:, 2] * squeeze, grey]


def _pairwise(points):
    d = points[:, None, :] - points[None, :, :]
    return np.sqrt((d * d).sum(axis=2))


def group(colours, holds, params=None):
    """A group label (0, 1, 2, ...) for each hold, from hold colours (Lab) and hold positions."""
    p = dict(PARAMS, **(params or {}))
    n = len(holds)
    if n == 0:
        return np.zeros(0, int)
    xy = np.array([[h["x"], h["y"]] for h in holds], float)
    ruler = float(np.median([np.sqrt(max(h["w"] * h["h"], 1.0)) for h in holds]))   # a typical hold, used as the unit of distance

    total = _pairwise(_features(colours, p))      # between two groups: the sum of colour differences over all pairs
    near = _pairwise(xy / ruler)                  # between two groups: the distance between their two nearest holds
    size = np.ones(n)
    alive = np.ones(n, bool)
    label = np.arange(n)
    far = lambda gap: p["far_weight"] * np.log1p(gap)
    cost = total + far(near)
    np.fill_diagonal(cost, np.inf)
    for _ in range(n - 1):
        a, b = divmod(int(np.argmin(cost)), n)
        if not cost[a, b] < p["limit"]:
            break
        # Join group b into group a.
        near[a] = np.minimum(near[a], near[b])
        near[:, a] = near[a]
        total[a] += total[b]
        total[:, a] = total[a]
        size[a] += size[b]
        alive[b] = False
        label[label == b] = a
        row = total[a] / (size[a] * size) + far(near[a])
        row[~alive] = np.inf
        row[a] = np.inf
        cost[a] = row
        cost[:, a] = row
        cost[b] = np.inf
        cost[:, b] = np.inf
    return np.unique(label, return_inverse=True)[1]


def find_routes(rgb, holds, params=None):
    """rgb: the photo as a numpy array (height x width x 3, red-green-blue, 0..255).
    holds: list of dicts with x, y (centre), w, h in pixels of the photo, optionally "outline"
    ([[x, y], ...], the hold's shape) and "id".

    Returns (per_hold, routes):
      per_hold[i] = {"color": "#rrggbb", "color_name": "yellow", "route": index into routes, or None}
      routes[j]   = {"id": j, "color": "#rrggbb", "color_name": "yellow", "holds": [hold ids]}
    Routes are ordered biggest first. A hold id is hold["id"] when present, otherwise its place in
    the list. A hold that groups with no other hold has route None.
    """
    p = dict(PARAMS, **(params or {}))
    if not holds:
        return [], []
    colours = hold_colours(rgb, holds, p)
    labels = group(colours, holds, p)
    ids = [h.get("id", i) for i, h in enumerate(holds)]
    members = {}
    for i, lab in enumerate(labels):
        members.setdefault(int(lab), []).append(i)
    per_hold = [{"color": lab_to_hex(c), "color_name": colour_name(c), "route": None} for c in colours]
    routes = []
    for m in sorted(members.values(), key=lambda m: (-len(m), m[0])):
        if len(m) < p["min_route_holds"]:
            continue
        c = np.median(colours[m], axis=0)
        for i in m:
            per_hold[i]["route"] = len(routes)
        routes.append({"id": len(routes), "color": lab_to_hex(c), "color_name": colour_name(c),
                       "holds": [ids[i] for i in m]})
    return per_hold, routes
