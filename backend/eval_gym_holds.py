"""Score the served hold detector on 19 hand-labelled gym photos, and say whether that is an independent test.

Usage:  .venv/bin/python eval_gym_holds.py             (detector about 15 s, then the overlap checks, about 6 min)
        .venv/bin/python eval_gym_holds.py draw DIR    (also saves each photo with labels and predictions drawn)

Photos: wall training images/indoor-bouldering-photos (Tomáš Sláma, CC BY-SA 4.0; a teammate's
folder, only read here). 19 of its photos have every hold and every volume (a big shape bolted
to the wall) outlined by hand: 1,688 outlines.

Scoring, the same rule as eval_detector.py: a labelled hold is found when a predicted box overlaps
its box with IoU of 0.5 or more, and each prediction can find one hold. Reported: the share of
labelled holds found, and the share of predictions that are a labelled hold.

The detector is run exactly as analyze.py runs it for /analyze: the photo turned upright,
models/holds.pt, whole photo plus overlapping tiles.

Is it an independent test? No. See overlap() and the note written into results_gym_holds.json.
The detector was trained on 300 photos from ClimbInst, and ClimbInst contains this photographer's
photos of the same two gyms (205 of the 300 training photos are his). None of the 19 is itself a
training photo, but 18 of them show a wall, with the same holds on it, that is also in a training
photo taken from another spot.

Writes results_gym_holds.json.
"""
import glob
import json
import os
import re
import sys
import time

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageOps
from torchvision.ops import box_iou

import detector

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "wall training images", "indoor-bouldering-photos")
WEIGHTS = os.path.join(HERE, "models", "holds.pt")
TILED = True              # analyze.YOLO_TILED, the served default
IOU = 0.5
# Hold size = the longer side of its box, in pixels of the photo (the photos are 1,920 px on the long side).
SIZES = (("under 20 px", 0, 20), ("20 to 40 px", 20, 40), ("over 40 px", 40, 10 ** 9))

# Overlap check. A training photo is "the same photo" when its small greyscale thumbnail and its
# perceptual hash both match. It shows "the same wall" when many local details (SIFT points) match
# and all fit one change of viewpoint.
SAME_PHOTO_CORR = 0.98    # thumbnail correlation
SAME_PHOTO_HASH = 16      # differing bits out of 256
WALL_MATCH = 40           # matched details; every pair at or above this that was viewed showed the same wall
# Pairs under WALL_MATCH, viewed side by side on 14 Nov 2026. Value: (training photo, what was seen).
SAME_WALL_BY_EYE = {
    "images/boulderhaus-phone/182.jpg": ("191_left.jpg", "same red pyramid, white hold and pink shapes, from the left"),
    "images/boulderhaus-camera/0003.jpg": ("0554.jpg", "same pink hold and white wedge at the foot of the wall"),
    "images/smichoff-camera/082.jpg": ("819.jpg", "same wall, small and far away in the training photo"),
}
# Viewed and NOT the same holds, although some details match (same gym, same printed wall panels).
NEW_WALL_BY_EYE = {
    "images/boulderhaus-phone/126.jpg": "closest training photos (0090.jpg, 0554.jpg) show the same gym with other holds",
}


def load():
    """[{name, image, boxes: [[x0, y0, x1, y1]], kinds: ["hold" | "volume"], outlines}] for the 19 labelled photos."""
    doc = json.load(open(os.path.join(DATA, "annotations", "holds-and-routes.json")))
    photos = []
    for im in doc["images"]:
        image = ImageOps.exif_transpose(Image.open(os.path.join(DATA, im["image_path"]))).convert("RGB")
        W, H = image.size
        assert (W, H) == (im["width_px"], im["height_px"]), im["image_path"]
        boxes, kinds, outlines = [], [], []
        for r in im["regions"]:
            xs = [min(max(p[0], 0), W) for p in r["polygon_xy"]]
            ys = [min(max(p[1], 0), H) for p in r["polygon_xy"]]
            if max(xs) - min(xs) < 2 or max(ys) - min(ys) < 2:
                continue
            boxes.append([min(xs), min(ys), max(xs), max(ys)])
            kinds.append(r["hold_type"])
            outlines.append([tuple(p) for p in r["polygon_xy"]])
        photos.append({"name": im["image_path"], "image": image, "boxes": boxes, "kinds": kinds, "outlines": outlines})
    return photos


def match(preds, truth):
    """eval_detector.py's rule. Returns (found: one flag per labelled hold, real: one flag per prediction)."""
    found, real = [False] * len(truth), [False] * len(preds)
    if not truth or not preds:
        return found, real
    iou = box_iou(torch.tensor([p[0] for p in preds]), torch.tensor(truth))
    for i, row in enumerate(iou):                    # best-scoring prediction picks first
        order = torch.argsort(row, descending=True).tolist()
        j = next((j for j in order if not found[j] and row[j] >= IOU), None)
        if j is not None:
            found[j], real[i] = True, True
    return found, real


def total(rows):
    """Totals over photos: every hold counts once, every prediction counts once."""
    holds, hit, preds = (sum(r[k] for r in rows) for k in ("holds", "holds_found", "predictions"))
    return {"photos": len(rows), "holds": holds, "found": round(hit / holds, 3) if holds else None,
            "predictions": preds, "predictions_real": round(hit / preds, 3) if preds else None}


# ---------------------------------------------------------------- overlap with the training photos

def _thumb(img, n=32):
    a = np.asarray(img.convert("L").resize((n, n), Image.BILINEAR), dtype=np.float32)
    a -= a.mean()
    norm = np.linalg.norm(a)
    return (a / norm).ravel() if norm else a.ravel()


def _hash(img, n=16):
    """Difference hash: is each pixel of a tiny copy brighter than its left neighbour. 256 bits."""
    a = np.asarray(img.convert("L").resize((n + 1, n), Image.BILINEAR), dtype=np.int16)
    return (a[:, 1:] > a[:, :-1]).ravel()


def _details(img):
    """SIFT points of the photo shrunk to 1000 px: (positions, descriptors)."""
    import cv2
    g = np.asarray(img.convert("L"))
    s = 1000 / max(g.shape)
    g = cv2.resize(g, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    kp, des = cv2.SIFT_create(nfeatures=3000).detectAndCompute(g, None)
    return np.float32([k.pt for k in kp]), des


def _wall_match(a, b):
    """Number of details of photo a found in photo b that all fit one change of viewpoint (a homography)."""
    import cv2
    (pa, da), (pb, db) = a, b
    if da is None or db is None or len(da) < 10 or len(db) < 10:
        return 0
    best = {}
    for m in cv2.BFMatcher(cv2.NORM_L2).knnMatch(da, db, k=2):
        if len(m) == 2 and m[0].distance < 0.7 * m[1].distance:
            if m[0].trainIdx not in best or m[0].distance < best[m[0].trainIdx].distance:
                best[m[0].trainIdx] = m[0]           # one match per detail of b, or a dark photo matches everything
    good = list(best.values())
    if len(good) < 8:
        return 0
    _, mask = cv2.findHomography(pa[[g.queryIdx for g in good]], pb[[g.trainIdx for g in good]], cv2.RANSAC, 4.0)
    return int(mask.sum()) if mask is not None else 0


def overlap(photos, splits=("train", "validation")):
    """For each photo: the closest ClimbInst photo in each split, as a copy and as the same wall.
    Returns {name: {split: {...}}} or None when the training photos are not on this machine."""
    out = {p["name"]: {} for p in photos}
    mine = [(p["name"], _thumb(p["image"]), _hash(p["image"]), _details(p["image"])) for p in photos]
    for split in splits:
        paths = sorted(glob.glob(os.path.join(HERE, "data", "climbinst", "yolo", split, "images", "*.jpg")))
        if not paths:
            return None
        best = {name: {"copy": (-1.0, 256, None), "wall": (0, None)} for name in out}
        for k, path in enumerate(paths):
            cand = Image.open(path)
            t, h, d = _thumb(cand), _hash(cand), _details(cand)
            for name, mt, mh, md in mine:
                corr, bits = float(mt @ t), int((mh != h).sum())
                if corr > best[name]["copy"][0]:
                    best[name]["copy"] = (corr, bits, os.path.basename(path))
                n = _wall_match(md, d)
                if n > best[name]["wall"][0]:
                    best[name]["wall"] = (n, os.path.basename(path))
            if (k + 1) % 60 == 0:
                print(f"  overlap check: {split} {k + 1}/{len(paths)}", flush=True)
        for name, b in best.items():
            corr, bits, copy_of = b["copy"]
            out[name][split] = {"photos_compared": len(paths),
                                "closest_thumbnail": copy_of, "thumbnail_correlation": round(corr, 3),
                                "hash_bits_different": bits,
                                "same_photo": corr >= SAME_PHOTO_CORR and bits <= SAME_PHOTO_HASH,
                                "closest_wall": b["wall"][1], "matched_details": b["wall"][0]}
    return out


def verdict(name, o):
    """(copy, wall_seen). copy: "training", "validation" or None, when the photo itself is in that set.
    wall_seen: a training photo shows the same wall with the same holds."""
    copy = "training" if o["train"]["same_photo"] else "validation" if o["validation"]["same_photo"] else None
    seen = copy == "training" or (name not in NEW_WALL_BY_EYE and
                                  (o["train"]["matched_details"] >= WALL_MATCH or name in SAME_WALL_BY_EYE))
    return copy, seen


def photographer_share(split="train"):
    """(photos in the split carrying this photographer's file names, photos in the split).
    His files are named with digits only, such as 0646.jpg or 191_left.jpg (a phone photo cut in two)."""
    names = os.listdir(os.path.join(HERE, "data", "climbinst", "yolo", split, "images"))
    return sum(bool(re.fullmatch(r"\d{3,4}(_|_left|_right)?\.jpg", n)) for n in names), len(names)


# ---------------------------------------------------------------- main

def draw(photo, preds, found, real, folder):
    """Labels: green outline when found, red when missed. Predictions: thin white box when it is a
    labelled hold, thick yellow box when it is not."""
    img = photo["image"].copy()
    d = ImageDraw.Draw(img)
    for pts, ok in zip(photo["outlines"], found):
        d.line(pts + [pts[0]], fill=(0, 255, 0) if ok else (255, 0, 0), width=3)
    for (box, _), ok in zip(preds, real):
        d.rectangle(box, outline=(255, 255, 255) if ok else (255, 255, 0), width=1 if ok else 4)
    img.save(os.path.join(folder, photo["name"].replace("images/", "").replace("/", "_")), quality=88)


def main():
    folder = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "draw" else None
    if folder:
        os.makedirs(folder, exist_ok=True)
    photos = load()
    rows, kinds, sizes = [], {}, {name: {"labelled": 0, "found": 0} for name, _, _ in SIZES}
    detector.detect(photos[0]["image"], WEIGHTS, tiled=TILED)      # load the model before timing
    t0 = time.time()
    for p in photos:
        preds = sorted(detector.detect(p["image"], WEIGHTS, tiled=TILED), key=lambda q: -q[1])
        found, real = match(preds, p["boxes"])
        for kind, box, ok in zip(p["kinds"], p["boxes"], found):
            side = max(box[2] - box[0], box[3] - box[1])
            band = next(name for name, lo, hi in SIZES if lo <= side < hi)
            for table, key in ((kinds, kind), (sizes, band)):
                k = table.setdefault(key, {"labelled": 0, "found": 0})
                k["labelled"] += 1
                k["found"] += ok
        rows.append({"photo": p["name"], "size": list(p["image"].size), "holds": len(p["boxes"]),
                     "holds_found": sum(found), "predictions": len(preds),
                     "found": round(sum(found) / len(p["boxes"]), 3),
                     "predictions_real": round(sum(real) / len(preds), 3) if preds else None})
        if folder:
            draw(p, preds, found, real, folder)
    seconds = (time.time() - t0) / len(photos)
    for k in list(kinds.values()) + list(sizes.values()):
        k["found_share"] = round(k["found"] / k["labelled"], 3) if k["labelled"] else None

    print("checking the 19 photos against the ClimbInst training and validation photos ...", flush=True)
    seen = overlap(photos)
    out = {
        "detector": "models/holds.pt (tiled), as served by /analyze",
        "data": "19 hand-labelled photos, wall training images/indoor-bouldering-photos (Tomáš Sláma)",
        "rule": "a labelled hold is found when a predicted box overlaps its box with IoU >= 0.5; one prediction per hold",
        "labels_complete": True,
        "labels_note": "Every hold and volume in the 19 photos is outlined, down to chips a few pixels wide "
                       "(checked by eye with the labels and predictions drawn on), so the share of predictions "
                       "that are real holds can be measured. It reads slightly low: a few predictions counted as "
                       "wrong sit on a real hold but do not overlap its label enough.",
        "seconds_per_photo": round(seconds, 2),
        "all": total(rows),
        "by_kind": kinds,
        "by_size": sizes,
    }
    if seen is None:
        out["independent"] = None
        out["independence_note"] = "Not checked: data/climbinst/yolo is not on this machine (run detector_data.py)."
    else:
        for r in rows:
            copy, wall_seen = verdict(r["photo"], seen[r["photo"]])
            r["overlap"] = dict(seen[r["photo"]], copy_of_a_photo_in=copy, wall_in_training=wall_seen)
            if r["photo"] in SAME_WALL_BY_EYE:
                r["overlap"]["by_eye"] = "same wall as training photo %s: %s" % SAME_WALL_BY_EYE[r["photo"]]
            if r["photo"] in NEW_WALL_BY_EYE:
                r["overlap"]["by_eye"] = NEW_WALL_BY_EYE[r["photo"]]
        copies = lambda where: sum(r["overlap"]["copy_of_a_photo_in"] == where for r in rows)
        not_copy = [r for r in rows if r["overlap"]["copy_of_a_photo_in"] is None]
        new_wall = [r for r in rows if not r["overlap"]["wall_in_training"]]
        his, n_train = photographer_share()
        out["not_a_copy"] = total(not_copy)
        out["new_wall"] = total(new_wall) if new_wall else None
        out["independent"] = False
        out["independence"] = {
            "photos": len(rows),
            "copy_in_training": copies("training"),
            "copy_in_validation": copies("validation"),
            "same_wall_in_training": len(rows) - len(new_wall),
            "new_wall": len(new_wall),
            "clean_share": round(len(new_wall) / len(rows), 3),
            "training_photos_by_this_photographer": his,
            "training_photos": n_train,
        }
        out["independence_note"] = (
            f"Not an independent test. {copies('training')} of the 19 photos are among the {n_train} training "
            f"photos, and {copies('validation')} is among the 60 validation photos (used to pick which training "
            f"checkpoint to keep). But {len(rows) - len(new_wall)} of 19 show a wall, with the same holds on it, "
            "that is also in a training photo taken from another spot: the training set contains this "
            f"photographer's photos of the same two gyms ({his} of its {n_train} photos). Only {len(new_wall)} of "
            "19 shows holds the detector has not seen, and it is in a gym it has seen; that is too few to be a "
            "score. Read these numbers as: new camera angles of walls the detector already knows."
        )
        # The same check for the detector's usual test set, the 50 ClimbInst test photos (results_detector.json).
        print("checking the 50 ClimbInst test photos against the training photos ...", flush=True)
        tests = [{"name": os.path.basename(f), "image": Image.open(f).convert("RGB")} for f in
                 sorted(glob.glob(os.path.join(HERE, "data", "climbinst", "yolo", "test", "images", "*.jpg")))]
        if tests:
            t = {name: o["train"] for name, o in overlap(tests, ("train",)).items()}
            most = max(o["matched_details"] for o in t.values())
            weakest = min([seen[r["photo"]]["train"]["matched_details"] for r in rows
                           if r["overlap"]["wall_in_training"]] or [WALL_MATCH])
            his_test, n_test = photographer_share("test")
            out["climbinst_test_overlap"] = {
                "photos": len(t),
                "copies_of_a_training_photo": sum(o["same_photo"] for o in t.values()),
                "most_matched_details": most,
                "photos_at_or_above_wall_match": sum(o["matched_details"] >= WALL_MATCH for o in t.values()),
                "test_photos_by_this_photographer": his_test,
                "note": f"No ClimbInst test photo shares a wall with a training photo by this check: the most "
                        f"matched details for any pair is {most}, against {weakest} for the weakest same-wall "
                        f"pair confirmed by eye among the 19 gym photos. None of the {n_test} test photos carries "
                        "this photographer's file names. The test photos come from other sources (phone photos, "
                        "competition walls), so results_detector.json is the number for walls the detector has "
                        "not seen." if most < weakest else
                        f"Some ClimbInst test photos may share a wall with a training photo (up to {most} matched "
                        "details). Look at those pairs before calling that test independent.",
            }
    out["per_photo"] = rows
    json.dump(out, open(os.path.join(HERE, "results_gym_holds.json"), "w"), indent=2, ensure_ascii=False)

    pct = lambda v: "n/a" if v is None else f"{v:.0%}"
    print(f"\n{'photo':38} {'holds':>5} {'found':>6} {'real':>6}  overlap with training")
    for r in rows:
        o = r.get("overlap", {})
        if o:
            note = ("the same photo is in " + o["copy_of_a_photo_in"] + "; ") if o["copy_of_a_photo_in"] else ""
            note += "same wall as training photo" if o["wall_in_training"] else "wall not in training; closest is"
            note += f" {o['train']['closest_wall']} ({o['train']['matched_details']} matched details)"
        else:
            note = "not checked"
        print(f"{r['photo'][7:]:38} {r['holds']:5d} {pct(r['found']):>6} {pct(r['predictions_real']):>6}  {note}")
    for key, label in (("all", "all 19"), ("not_a_copy", "not a copy of a training/validation photo"),
                       ("new_wall", "wall not in any training photo")):
        t = out.get(key)
        if t:
            print(f"{label}: {t['photos']} photos, {t['holds']} holds, found {pct(t['found'])}, "
                  f"predictions that are real holds {pct(t['predictions_real'])}")
    print("found, by kind:", {k: f"{v['found_share']:.0%} of {v['labelled']}" for k, v in kinds.items()})
    print("found, by size:", {k: f"{pct(v['found_share'])} of {v['labelled']}" for k, v in sizes.items()})
    print(out["independence_note"])
    if "climbinst_test_overlap" in out:
        print(out["climbinst_test_overlap"]["note"])


if __name__ == "__main__":
    main()
