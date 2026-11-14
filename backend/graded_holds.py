"""Find the marked holds in a guidebook picture of a graded problem.

The graded pictures (see data/graded-climbs/README.md) each show one wall with
one problem's holds marked by the guidebook's authors:

- every hold of the problem has a white line drawn around it, about 2 pixels
  wide, and its inside is faded toward white;
- a start hold has one or two short white lines ("tails") sticking out of it,
  usually downward. Two tails on one hold: both hands start there. One tail on
  each of two holds: one hand on each;
- the finish hold has a second white line drawn around the first (a double
  outline).

Nothing here is learned. A pixel counts as "drawn" when all three colour
channels are high (or it is the bright cyan used for a few swapped holds); closed white shapes are filled, thin lines are stripped off
to leave the hold bodies, the stripped lines that touch a body are its tails,
and a body whose rim reads white, not white, white going inward is a finish.

Needs only numpy, scipy and Pillow.

    python graded_holds.py OUT_DIR [N]   # draw what is found over N pictures spread across the grades
"""
import csv
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
# Where the pictures are: the shared folder first, then the local copy.
DATA_DIRS = [os.path.join(HERE, "..", "wall training images", "graded-climbs"),
             os.path.join(HERE, "data", "graded-climbs")]

WHITE_MIN = 215        # every channel at least this bright ...
WHITE_SPREAD = 45      # ... and the channels within this of each other: drawn white, not a pale colour
DIM_MIN = 185          # a pixel this bright may continue a white line it touches
LINE_MIN = 225         # brightness of a drawn line when read along a line crossing it
GAP_MAX = 205          # the gap between the two lines of a double outline is darker than this
DOUBLE_SHARE = 0.66    # a finish has the line, gap, line pattern at least this much of the way round
EDGE = 24              # pixels of mirrored border added while searching
MIN_AREA = 14          # smallest hold body, in pixels, outline included
MIN_TAIL = 5           # shortest tail, in pixels
EIGHT = np.ones((3, 3), bool)
# 5 x 5 with the corners cut off: wide enough that a 2 or 3 pixel line cannot contain it.
DISC = np.array([[0, 1, 1, 1, 0], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [0, 1, 1, 1, 0]], bool)


def data_dir():
    for d in DATA_DIRS:
        if os.path.exists(os.path.join(d, "labels.csv")):
            return os.path.normpath(d)
    raise FileNotFoundError("graded-climbs not found in: " + ", ".join(map(os.path.normpath, DATA_DIRS)))


def load_labels():
    """The rows of labels.csv, each with 'path' (absolute) and 'v' (the grade as a number) added."""
    root = data_dir()
    rows = list(csv.DictReader(open(os.path.join(root, "labels.csv"), encoding="utf-8-sig")))
    for r in rows:
        r["path"] = os.path.join(root, r["image_path"])
        r["v"] = int(r["grade"].lstrip("Vv"))
    return rows


def _drawn(rgb):
    """Pixels in the colour of a drawn line: white, or the bright cyan the
    guidebook uses for a few holds (its captions call them "blue marked": a hold
    that has been swapped for another since the wall photo was taken)."""
    a = rgb.astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    low, high = a.min(axis=2), a.max(axis=2)
    white = (low >= WHITE_MIN) & (high - low <= WHITE_SPREAD)
    cyan = (g >= 195) & (b >= 195) & (r <= np.minimum(g, b) - 55)
    # A line over a strongly coloured hold picks up a tint from it (the picture
    # format stores colour more coarsely than brightness). Allowed only as a
    # continuation of a line, never as the start of one.
    tinted = ((low >= DIM_MIN) & (high - low <= WHITE_SPREAD + 25) & (high >= 235)) \
        | ((g >= 195) & (b >= 170) & (r <= g - 60))
    # One number per pixel, high on a drawn line, for reading across an edge.
    level = np.where(cyan, np.minimum(g, b), low)
    return white | cyan, tinted, level


def _trace(mask):
    """Outline of one filled shape as a list of [x, y] pixels, in order."""
    m = np.pad(mask, 1)
    ys, xs = np.nonzero(m)
    start = (int(ys[0]), int(xs[0]))                 # top-most, then left-most pixel
    # Walk the boundary keeping the shape on the right (Moore neighbour tracing).
    ring = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
    pts, cur, back = [start], start, 6               # we arrived "from the left"
    for _ in range(4 * mask.size + 8):
        for k in range(8):
            d = (back + 1 + k) % 8
            ny, nx = cur[0] + ring[d][0], cur[1] + ring[d][1]
            if m[ny, nx]:
                back = (d + 4) % 8
                cur = (ny, nx)
                break
        else:
            break                                    # a single pixel
        if cur == start:
            break
        pts.append(cur)
    return [[int(x - 1), int(y - 1)] for y, x in pts]


def _thin(points, keep=40):
    step = max(1, len(points) // keep)
    return points[::step]


def _double_share(bright, body):
    """How much of the way round `body` there is a second white line next to the first.

    At each point of the edge, read the brightness along a short line crossing the
    edge at right angles, from inside the shape to just outside it. A double
    outline reads white, dark gap, white. Returns the share of edge points where
    it does (0 to 1). This looks at each stretch of the edge on its own, so it
    still works when the picture's compression has broken a line in places, and
    whether the shape that was found is the outer line or the inner one.
    """
    H, W = bright.shape
    signed = ndi.distance_transform_edt(~body) - ndi.distance_transform_edt(body)    # negative inside
    gy, gx = np.gradient(ndi.gaussian_filter(signed, 1.5))
    # Not so far in that the line reaches the outline on the far side of a small hold.
    steps = np.arange(-min(9.0, 0.75 * float(-signed.min())), 8.01, 0.5)
    ys, xs = np.nonzero(body & ~ndi.binary_erosion(body, EIGHT))
    hits = total = 0
    for y, x in zip(ys, xs):
        n = np.hypot(gx[y, x], gy[y, x])
        if n < 1e-3:
            continue
        px = np.round(x + steps * gx[y, x] / n).astype(int)
        py = np.round(y + steps * gy[y, x] / n).astype(int)
        if px.min() < 0 or py.min() < 0 or px.max() >= W or py.max() >= H:
            continue
        v = bright[py, px]
        total += 1
        lit = np.flatnonzero(v >= LINE_MIN)
        if lit.size == 0:
            continue
        runs = np.split(lit, np.flatnonzero(np.diff(lit) > 1) + 1)
        for a, b in zip(runs, runs[1:]):
            gap = v[a[-1] + 1:b[0]]
            # A gap at most 4 pixels wide, clearly darker than the white on both sides,
            # with a thin line (not a whole pale hold) on its outer side.
            if gap.size <= 8 and len(b) <= 10 and gap.min() <= GAP_MAX \
                    and gap.min() <= min(v[a].max(), v[b].max()) - 40:
                hits += 1
                break
    return hits / total if total >= 8 else 0.0


def _split(body):
    """Two outlined holds that touch come out as one shape joined by a narrow neck.
    Returns one mask per hold: the shape is cut where shaving a few pixels off its
    edge leaves two or more solid pieces."""
    for r in (1, 2, 3):
        cores, n = ndi.label(ndi.binary_erosion(body, EIGHT, iterations=r))
        if n < 2:
            continue
        sizes = ndi.sum(np.ones_like(cores), cores, range(1, n + 1))
        keep = [k + 1 for k, a in enumerate(sizes) if a >= 12]
        if len(keep) < 2:
            continue
        # Give every pixel of the shape to the nearest solid piece.
        solid = np.isin(cores, keep)
        _, (iy, ix) = ndi.distance_transform_edt(~solid, return_indices=True)
        owner = cores[iy, ix]
        return [body & (owner == k) for k in keep]
    return [body]


def find_marked_holds(image):
    """image: a path or a PIL image. Returns {"image": {"w", "h"}, "holds": [...]}.

    Each hold: id, x, y (centre), w, h (box), area_px, outline (points around it),
    tails (number of short lines sticking out), start (has a tail), finish
    (double outline), hollow (the inside is not solid white). Pixels of the picture.
    """
    if not isinstance(image, Image.Image):
        image = Image.open(image)
    rgb = np.asarray(image.convert("RGB"))
    H, W = rgb.shape[:2]
    # Mirror the picture outward at its borders, so a marked hold cut off by the
    # border becomes a closed shape; the mirrored strip is thrown away at the end.
    rgb = np.pad(rgb, ((EDGE, EDGE), (EDGE, EDGE), (0, 0)), mode="symmetric")
    white, tinted, bright = _drawn(rgb)

    # Close 1-pixel breaks in the drawn lines, then fill every closed shape.
    close = lambda m: ndi.binary_closing(np.pad(m, 2), EIGHT)[2:-2, 2:-2]
    filled = ndi.binary_fill_holes(close(white))
    # A thin line can dim or pick up a tint for a few pixels. Look again with
    # lines allowed to continue through such pixels (up to 3 steps from proper
    # white), and add the insides of the shapes that this closes. Not the dimmer
    # pixels themselves: the lines must stay thin so they can be stripped below.
    loose = close(ndi.binary_dilation(white, EIGHT, iterations=3, mask=white | tinted))
    loose_filled = ndi.binary_fill_holes(loose)
    filled |= ndi.binary_dilation(loose_filled & ~loose, EIGHT) & loose_filled
    # Strip thin lines (tails, stray specks); what survives are hold bodies.
    bodies = ndi.binary_opening(filled, DISC)
    bodies = ndi.binary_dilation(bodies, EIGHT) & filled          # give back the rounded-off corners
    label, n = ndi.label(bodies, EIGHT)
    inside = filled & ~white                                      # the not-white inside of closed shapes

    # Cut apart outlines that touch each other, and renumber the pieces.
    pieces = np.zeros_like(label)
    count = 0
    for i, sl in enumerate(ndi.find_objects(label), start=1):
        for part in _split(label[sl] == i):
            count += 1
            pieces[sl][part] = count
    label = pieces

    in_picture = np.zeros(label.shape, bool)
    in_picture[EDGE:EDGE + H, EDGE:EDGE + W] = True

    holds = []
    for i, sl in enumerate(ndi.find_objects(label), start=1):
        whole = label[sl] == i
        body = whole & in_picture[sl]                 # drop the mirrored part, and mirrored copies entirely
        area = int(body.sum())
        if area < MIN_AREA or area < 0.4 * whole.sum():
            continue
        hollow_px = int((inside[sl] & body).sum())
        ys, xs = np.nonzero(body)
        bw, bh = int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
        # A shape with no inside at all is plain white paint or a bright patch of the
        # photo unless it is compact: a drawn outline around a faded white hold.
        if hollow_px < 3 and (area < 30 or area < 0.6 * bw * bh):
            continue
        ox, oy = sl[1].start - EDGE, sl[0].start - EDGE           # back to the picture's own pixels
        big = tuple(slice(max(c.start - 14, 0), c.stop + 14) for c in sl)
        share = _double_share(bright[big], label[big] == i)
        holds.append({
            "x": round(float(xs.mean()) + ox, 1), "y": round(float(ys.mean()) + oy, 1),
            "w": bw, "h": bh, "area_px": area, "hollow": hollow_px >= 3,
            "outline": [[x + ox, y + oy] for x, y in _thin(_trace(body))],
            "double_share": round(share, 2), "finish": share >= DOUBLE_SHARE, "_label": i, "tails": 0,
        })

    # Tails: thin white lines that touch a body and reach away from it.
    lines = white & ~ndi.binary_dilation(bodies, EIGHT)
    line_label, _ = ndi.label(lines, EIGHT)
    near = ndi.grey_dilation(label, footprint=np.ones((5, 5), bool))   # which body each pixel is next to
    reach = ndi.distance_transform_edt(~bodies)
    by_label = {h["_label"]: h for h in holds}
    bridges = []
    for j, sl in enumerate(ndi.find_objects(line_label), start=1):
        part = line_label[sl] == j
        ys, xs = np.nonzero(part)
        length = max(xs.max() - xs.min(), ys.max() - ys.min()) + 1
        if length < 2 or part.sum() > 4.0 * length or length > 40:
            continue
        touching = [by_label[t] for t in np.unique(near[sl][part]) if t in by_label]
        if not touching:
            continue
        # Tails hang down from their hold. One that runs into a second hold below
        # belongs to the upper of the two.
        owner = min(touching, key=lambda h: h["y"])
        if length >= MIN_TAIL and float(reach[sl][part].max()) >= MIN_TAIL:
            owner["tails"] += 1
        elif len(touching) >= 2:
            bridges.append(owner)                     # a short line joining two holds: maybe a tail
    # A problem starts with two hands, so two tails. Count the short joining lines
    # only while the picture is still short of two.
    for owner in bridges:
        if sum(h["tails"] for h in holds) < 2:
            owner["tails"] += 1

    # A problem has one finish. When no hold passes the test outright, take the
    # best one if it is at least half way there.
    if holds and not any(h["finish"] for h in holds):
        best = max(holds, key=lambda h: h["double_share"])
        best["finish"] = best["double_share"] >= 0.5

    holds.sort(key=lambda h: (-h["y"], h["x"]))                   # bottom of the picture first
    for k, h in enumerate(holds):
        h.pop("_label")
        h["id"] = k
        h["start"] = h["tails"] > 0
    return {"image": {"w": W, "h": H}, "holds": holds}


def draw(image, found, scale=3):
    """The picture enlarged with what was found drawn on it: red outline for a hold,
    green for a start (S1 or S2 = number of tails), blue for a finish (F)."""
    if not isinstance(image, Image.Image):
        image = Image.open(image)
    im = image.convert("RGB").resize((image.width * scale, image.height * scale), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    for h in found["holds"]:
        colour = (0, 90, 255) if h["finish"] else (0, 200, 0) if h["start"] else (255, 0, 0)
        pts = [((x + 0.5) * scale, (y + 0.5) * scale) for x, y in h["outline"]]
        if len(pts) >= 2:
            d.line(pts + pts[:1], fill=colour, width=2)
        tag = str(h["id"]) + ("F" if h["finish"] else "") + (f"S{h['tails']}" if h["start"] else "")
        d.text(((h["x"] + h["w"] / 2 + 1) * scale, (h["y"] - h["h"] / 2 - 3) * scale), tag, fill=(255, 255, 0),
               stroke_width=2, stroke_fill=(0, 0, 0))
    return im


if __name__ == "__main__":
    out = sys.argv[1]
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 18
    os.makedirs(out, exist_ok=True)
    rows = sorted(load_labels(), key=lambda r: (r["v"], r["image_path"]))
    step = len(rows) / count
    for r in [rows[int(k * step)] for k in range(count)]:
        found = find_marked_holds(r["path"])
        name = r["image_path"].replace("images/", "").replace("/", "_").replace(".jpg", ".png")
        draw(r["path"], found).save(os.path.join(out, name))
        print(f"{r['grade']:>4} {r['route_name']:<28} holds {len(found['holds']):>2}  "
              f"start {[h['id'] for h in found['holds'] if h['start']]} "
              f"tails {sum(h['tails'] for h in found['holds'])}  "
              f"finish {[h['id'] for h in found['holds'] if h['finish']]}")
