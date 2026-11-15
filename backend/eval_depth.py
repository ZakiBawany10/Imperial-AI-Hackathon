"""How well does the 3D wall mesh show what sticks out of the wall?

Usage:  python3 eval_depth.py

There is no laser scan of these walls, so the test is what we do know for sure: in 19 photos
every hold and volume has been outlined by hand ("wall training images/indoor-bouldering-photos",
holds-and-routes.json). A good relief map is high inside those outlines and low on the bare
wall around them, with volumes (big bolted-on shapes) higher than ordinary holds.

Measured per photo, then averaged:
  stands out    AUC: the chance that a random pixel inside a hold has more relief than a random
                pixel of bare wall (0.5 = no better than chance, 1.0 = perfect separation)
  holds raised  share of holds whose middle sticks out more than 90% of the bare wall
  volumes       how much more a volume sticks out than an ordinary hold, on average (relief units)
Settings compared: two depth models (Small, Base) and how wide an area counts as "the wall"
when the flat wall is taken away (the blur width, as a share of the photo's long side).
Writes results_depth.json.
"""
import json
import os

import numpy as np
import torch
from PIL import Image, ImageDraw
from scipy import ndimage
from sklearn.metrics import roc_auc_score

HERE = os.path.dirname(os.path.abspath(__file__))
SET = os.path.join(HERE, "..", "wall training images", "indoor-bouldering-photos")
MODELS = {"base": "depth-anything/Depth-Anything-V2-Base-hf"}
WIDTHS = [0.05, 0.02, "bumps", "depth+bumps"]
SIDE = 512


def raw_depth(model_id, image, cache={}):
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation
    if model_id not in cache:
        dev = "mps" if torch.backends.mps.is_available() else "cpu"
        cache[model_id] = (AutoImageProcessor.from_pretrained(model_id), AutoModelForDepthEstimation.from_pretrained(model_id).to(dev).eval(), dev)
    proc, model, dev = cache[model_id]
    with torch.no_grad():
        d = model(**proc(images=image, return_tensors="pt").to(dev)).predicted_depth
    W, H = image.size
    s = SIDE / max(W, H)
    return torch.nn.functional.interpolate(d[:, None], size=(round(H * s), round(W * s)), mode="bicubic")[0, 0].cpu().numpy(), s


def relief(d, width):
    """Same filter as depth.py. width: one blur width, or (narrow, wide, weight of the wide part):
    a narrow pass that brings out holds plus a wide pass that keeps big shapes whole."""
    h, w = d.shape
    hp = lambda k: d - ndimage.gaussian_filter(d, k * max(w, h))
    if isinstance(width, tuple):
        n, wd, k = width
        a, b = hp(n), hp(wd)
        a, b = a - np.median(a), b - np.median(b)
        r = np.maximum(a, 0) + k * np.maximum(b, 0)
    else:
        r = hp(width)
    r -= np.median(r)
    return r


SEG = os.path.join(HERE, "runs", "holds_seg", "weights", "best.pt")


def detected_bumps(img, shape, cache={}):
    """Relief from the hold-outline model alone: each detected hold becomes a smooth dome over
    its own outline, higher for bigger holds (big shapes stick out further). 0..1, at `shape`."""
    from ultralytics import YOLO
    if "m" not in cache:
        cache["m"] = YOLO(SEG)
    h, w = shape
    r = cache["m"].predict(img, imgsz=832, conf=0.25, retina_masks=True, max_det=600, verbose=False,
                           device="mps" if torch.backends.mps.is_available() else "cpu")[0]
    out = np.zeros(shape, np.float32)
    if r.masks is None:
        return out
    for m in r.masks.data.cpu().numpy():
        m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize((w, h))) > 127
        if m.sum() < 4:
            continue
        dist = ndimage.distance_transform_edt(m)
        import depth
        height = depth.hold_dome_height(np.sqrt(m.sum()) / max(h, w))
        out = np.maximum(out, height * np.sqrt(dist / dist.max()))
    return out


def masks(regions, size, scale):
    """(hold mask, volume mask, bare wall mask, [(kind, mask) per region]) at the relief map's size."""
    w, h = size
    hold = Image.new("L", (w, h)); vol = Image.new("L", (w, h)); each = []
    for reg in regions:
        pts = [(x * scale, y * scale) for x, y in reg["points"]]
        if len(pts) < 3:
            continue
        m = Image.new("L", (w, h)); ImageDraw.Draw(m).polygon(pts, fill=1)
        kind = "volume" if "volume" in str(reg.get("kind", "")).lower() else "hold"
        ImageDraw.Draw(vol if kind == "volume" else hold).polygon(pts, fill=1)
        each.append((kind, np.asarray(m, bool)))
    hold, vol = np.asarray(hold, bool), np.asarray(vol, bool)
    anything = hold | vol
    wall = ~ndimage.binary_dilation(anything, iterations=4)        # a margin, since outlines are not pixel-exact
    return hold, vol, wall, each


def main():
    ann = json.load(open(os.path.join(SET, "annotations", "holds-and-routes.json")))
    photos = ann["images"]
    results = {}
    for name, mid in MODELS.items():
        rows = {w: [] for w in WIDTHS}
        for ph in photos:
            img = Image.open(os.path.join(SET, ph["image_path"])).convert("RGB")
            d, s = raw_depth(mid, img)
            regions = [{"points": r["polygon_xy"], "kind": r.get("hold_type", "hold")} for r in ph["regions"]]
            hold, vol, wall, each = masks(regions, (d.shape[1], d.shape[0]), s)
            bumps = detected_bumps(img, d.shape)
            for w in WIDTHS:
                if w == "bumps":
                    r = bumps
                elif w == "depth+bumps":
                    r0 = relief(d, 0.02)
                    r0 = np.clip(r0 / max(np.percentile(r0, 99.5), 1e-6), 0, 1)
                    r = np.maximum(0.6 * r0, bumps)        # what depth.py ships
                else:
                    r = relief(d, w)
                inside, bare = r[hold | vol], r[wall]
                if len(inside) < 10 or len(bare) < 10:
                    continue
                rng = np.random.default_rng(0)
                a, b = rng.choice(inside, min(4000, len(inside))), rng.choice(bare, min(4000, len(bare)))
                auc = roc_auc_score(np.r_[np.ones(len(a)), np.zeros(len(b))], np.r_[a, b])
                p90 = np.percentile(bare, 90)
                raised = [float(np.median(r[m]) > p90) for k, m in each if m.sum() >= 3]
                scale = np.percentile(r, 99) - np.median(bare) or 1
                hv = [np.median(r[m]) for k, m in each if k == "hold" and m.sum() >= 3]
                vv = [np.median(r[m]) for k, m in each if k == "volume" and m.sum() >= 3]
                rows[w].append({"auc": auc, "raised": np.mean(raised) if raised else np.nan,
                                "vol_minus_hold": (np.mean(vv) - np.mean(hv)) / scale if vv and hv else np.nan})
        for w in WIDTHS:
            rs = rows[w]
            results[f"{name}, wall blur {w}"] = {
                "photos": len(rs), "stands_out_auc": round(float(np.nanmean([x["auc"] for x in rs])), 3),
                "holds_raised": round(float(np.nanmean([x["raised"] for x in rs])), 3),
                "volumes_above_holds": round(float(np.nanmean([x["vol_minus_hold"] for x in rs])), 3)}
            print(f"{name:5s} blur {str(w):<18}", results[f"{name}, wall blur {w}"])
    best = max(results, key=lambda k: (results[k]["stands_out_auc"], results[k]["holds_raised"]))
    print("best:", best, results[best])
    json.dump({"what": __doc__.strip().splitlines()[0], "data": "19 photos with every hold and volume outlined by hand",
               "results": results, "best": best}, open(os.path.join(HERE, "results_depth.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
