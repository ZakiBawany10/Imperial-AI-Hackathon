"""Trained hold detector (YOLO). Same output as detect_holds.detect: [(box [x0, y0, x1, y1], score)]."""
import functools

import torch

IMGSZ = 832       # training and inference size; 1024 at batch 8 needed 11 GB and swapped on a 16 GB laptop
BATCH = 4
CONF = 0.25


@functools.lru_cache(maxsize=2)
def _model(weights):
    from ultralytics import YOLO
    return YOLO(weights)


def detect(img, weights, conf=CONF, imgsz=IMGSZ):
    """img: a PIL image. weights: path to a .pt file from train_detector.py."""
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    r = _model(weights).predict(img, imgsz=imgsz, conf=conf, iou=0.5, max_det=1000, device=device, verbose=False)[0]
    return [(b.tolist(), float(s)) for b, s in zip(r.boxes.xyxy.cpu(), r.boxes.conf.cpu())]
