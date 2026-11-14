"""Trained hold detector (YOLO). Same output as detect_holds.detect: [(box [x0, y0, x1, y1], score)]."""
import functools

import torch
from torchvision.ops import nms

IMGSZ = 832       # training and inference size; 1024 at batch 8 needed 11 GB and swapped on a 16 GB laptop
BATCH = 4
CONF = 0.25
TRAIN_SIDE = 1600  # training photos were shrunk to this long side (detector_data.MAX_SIDE)
TILE = 1000        # with tiled=True: overlapping crops of the photo, so small holds are seen larger
OVERLAP = 250
TILE_MAX_BOX = 0.4 # a tile only contributes boxes up to this share of its side; it sees big holds and volumes in pieces


@functools.lru_cache(maxsize=2)
def _model(weights):
    from ultralytics import YOLO
    return YOLO(weights)


def _run(model, img, conf, device):
    r = model.predict(img, imgsz=IMGSZ, conf=conf, iou=0.5, max_det=1000, device=device, verbose=False)[0]
    return r.boxes.xyxy.cpu(), r.boxes.conf.cpu()


def detect(img, weights, conf=CONF, tiled=False):
    """img: a PIL image. weights: path to a .pt file from train_detector.py.
    The photo is first brought to the scale the model was trained on."""
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = _model(weights)
    W, H = img.size
    scale = min(1.0, TRAIN_SIDE / max(W, H))
    small = img.resize((round(W * scale), round(H * scale))) if scale < 1 else img
    boxes, scores = _run(model, small, conf, device)
    if tiled:
        w, h = small.size
        step = TILE - OVERLAP
        xs = sorted({min(x, max(w - TILE, 0)) for x in range(0, max(w - OVERLAP, 1), step)})
        ys = sorted({min(y, max(h - TILE, 0)) for y in range(0, max(h - OVERLAP, 1), step)})
        all_b, all_s = [boxes], [scores]
        for y in ys:
            for x in xs:
                b, s = _run(model, small.crop((x, y, min(x + TILE, w), min(y + TILE, h))), conf, device)
                # drop boxes cut by an inner tile edge: the neighbouring tile sees the whole hold
                keep = torch.ones(len(b), dtype=torch.bool)
                tw, th = min(x + TILE, w) - x, min(y + TILE, h) - y
                if len(b):
                    keep &= torch.maximum(b[:, 2] - b[:, 0], b[:, 3] - b[:, 1]) <= TILE_MAX_BOX * TILE
                    keep &= (b[:, 0] > 2) | (x == 0)
                    keep &= (b[:, 1] > 2) | (y == 0)
                    keep &= (b[:, 2] < tw - 2) | (x + tw >= w)
                    keep &= (b[:, 3] < th - 2) | (y + th >= h)
                all_b.append(b[keep] + torch.tensor([x, y, x, y]))
                all_s.append(s[keep])
        boxes, scores = torch.cat(all_b), torch.cat(all_s)
        keep = nms(boxes, scores, 0.5)
        boxes, scores = boxes[keep], scores[keep]
    return [((b / scale).tolist(), float(s)) for b, s in zip(boxes, scores)]
