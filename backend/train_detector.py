"""Train the hold detector on the ClimbInst sample from detector_data.py.

Usage:  python3 train_detector.py [epochs]        (default 40)

Starts from Ultralytics YOLO11s pretrained on COCO and fine-tunes it to one
class, "hold". The best checkpoint (by validation score) is copied to
models/holds.pt. Score it with:  python3 eval_detector.py models/holds.pt
"""
import os
import shutil
import sys

import torch
from ultralytics import YOLO

import detector

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    epochs = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    model = YOLO("yolo11s.pt")
    run = model.train(data=os.path.join(HERE, "data", "climbinst", "yolo", "data.yaml"),
                      epochs=epochs, imgsz=detector.IMGSZ, batch=detector.BATCH, patience=10, seed=0, workers=2,
                      device="mps" if torch.backends.mps.is_available() else "cpu",
                      project=os.path.join(HERE, "runs"), name="holds", exist_ok=True, plots=False)
    os.makedirs(os.path.join(HERE, "models"), exist_ok=True)
    shutil.copy(os.path.join(run.save_dir, "weights", "best.pt"), os.path.join(HERE, "models", "holds.pt"))
    print("saved models/holds.pt")


if __name__ == "__main__":
    main()
