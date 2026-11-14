"""Train the hold-type classifier on the close-ups from type_data.py, then score it.

Usage:  python3 train_type.py [epochs]        (default 12)

Starts from Ultralytics YOLO11n-cls pretrained on ImageNet. The best checkpoint
is copied to models/hold_type.pt. The score on the held-out test photos is
written to results_type.json: how often the top guess is right, how often the
right type is in the top three, and how accurate the confident guesses are
(the ones /analyze will not ask the user to confirm).
"""
import glob
import json
import os
import shutil
import sys

import torch
from PIL import Image
from ultralytics import YOLO

import hold_type

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data", "holdtypes", "crops")
CONFIDENT = 0.6      # analyze.REVIEW_BELOW


def score():
    model = YOLO(hold_type.WEIGHTS)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    rows = []                                          # (true class, ranked classes, top probability)
    for cls in sorted(os.listdir(os.path.join(DATA, "test"))):
        files = sorted(glob.glob(os.path.join(DATA, "test", cls, "*.jpg")))
        for i in range(0, len(files), 128):
            for r in model.predict([Image.open(f) for f in files[i:i + 128]], imgsz=hold_type.SIDE, device=device, verbose=False):
                p = r.probs.data.cpu()
                order = torch.argsort(p, descending=True).tolist()
                rows.append((cls, [r.names[j] for j in order], float(p[order[0]])))
    n = len(rows)
    sure = [r for r in rows if r[2] >= CONFIDENT]
    classes = sorted({r[0] for r in rows})
    out = dict(test_holds=n,
               top1=round(sum(r[0] == r[1][0] for r in rows) / n, 3),
               top3=round(sum(r[0] in r[1][:3] for r in rows) / n, 3),
               confident_share=round(len(sure) / n, 3),
               confident_top1=round(sum(r[0] == r[1][0] for r in sure) / max(len(sure), 1), 3),
               always_guess_most_common=round(max(sum(r[0] == c for r in rows) for c in classes) / n, 3),
               per_class_top1={c: round(sum(r[0] == r[1][0] for r in rows if r[0] == c) / max(sum(r[0] == c for r in rows), 1), 3)
                               for c in classes})
    print(out)
    json.dump(out, open(os.path.join(HERE, "results_type.json"), "w"), indent=2)


def main():
    epochs = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    if epochs > 0:
        run = YOLO("yolo11n-cls.pt").train(data=DATA, epochs=epochs, imgsz=hold_type.SIDE, batch=128, patience=4, seed=0,
                                           workers=2, device="mps" if torch.backends.mps.is_available() else "cpu",
                                           project=os.path.join(HERE, "runs"), name="hold_type", exist_ok=True, plots=False)
        shutil.copy(os.path.join(run.save_dir, "weights", "best.pt"), hold_type.WEIGHTS)
    score()


if __name__ == "__main__":
    main()
