"""Score a hold detector: what share of labelled holds does it find?

Usage:  python3 eval_detector.py zero-shot [split]
        python3 eval_detector.py models/holds.pt [split] [tiled]

split is test (default), validation or train, under data/climbinst/yolo/.
A labelled hold counts as found when a predicted box overlaps it with
IoU >= 0.5; each prediction can match one hold. Also reports precision (share
of predictions that are a real hold). Appends the result to results_detector.json.
"""
import glob
import json
import os
import sys
import time

import torch
from PIL import Image
from torchvision.ops import box_iou

HERE = os.path.dirname(os.path.abspath(__file__))
IOU = 0.5


def zero_shot():
    import analyze
    import detect_holds
    processor, model, device = analyze._detector()
    return lambda img: detect_holds.detect(img, processor, model, device)


def yolo(weights, tiled):
    import detector
    return lambda img: detector.detect(img, weights, tiled=tiled)


def main():
    which = sys.argv[1]
    split = sys.argv[2] if len(sys.argv) > 2 else "test"
    tiled = "tiled" in sys.argv[3:]
    detect = zero_shot() if which == "zero-shot" else yolo(which, tiled)
    if tiled:
        which += " (tiled)"
    found = labelled = predicted = 0
    t0 = time.time()
    paths = sorted(glob.glob(os.path.join(HERE, "data", "climbinst", "yolo", split, "images", "*.jpg")))
    for path in paths:
        img = Image.open(path).convert("RGB")
        W, H = img.size
        label = path.replace("/images/", "/labels/").rsplit(".", 1)[0] + ".txt"
        truth = []
        for line in open(label):
            _, cx, cy, w, h = map(float, line.split())
            truth.append([(cx - w / 2) * W, (cy - h / 2) * H, (cx + w / 2) * W, (cy + h / 2) * H])
        preds = sorted(detect(img), key=lambda p: -p[1])
        labelled += len(truth)
        predicted += len(preds)
        if not truth or not preds:
            continue
        iou = box_iou(torch.tensor([p[0] for p in preds]), torch.tensor(truth))
        taken = set()
        for row in iou:                              # best-scoring prediction picks first
            order = torch.argsort(row, descending=True).tolist()
            j = next((j for j in order if j not in taken and row[j] >= IOU), None)
            if j is not None:
                taken.add(j)
        found += len(taken)
    out = dict(detector=which, split=split, photos=len(paths), holds=labelled,
               found=round(found / labelled, 3), precision=round(found / max(predicted, 1), 3),
               seconds_per_photo=round((time.time() - t0) / max(len(paths), 1), 2))
    print(out)
    log = os.path.join(HERE, "results_detector.json")
    rows = json.load(open(log)) if os.path.exists(log) else []
    rows = [r for r in rows if (r["detector"], r["split"]) != (which, split)] + [out]
    json.dump(rows, open(log, "w"), indent=2)


if __name__ == "__main__":
    main()
