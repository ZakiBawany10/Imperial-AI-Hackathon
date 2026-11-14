"""Hold type from a close-up: crop a hold out of a photo, classify it.

The same crop() is used to build training data (type_data.py) and at
prediction time, so the classifier always sees holds framed the same way.
"""
import functools
import os

HERE = os.path.dirname(os.path.abspath(__file__))
WEIGHTS = os.path.join(HERE, "models", "hold_type.pt")
SIDE = 128
MARGIN = 1.3        # crop side as a multiple of the hold's longer side, to keep some wall around it
# Class names in the training data -> type ids in hold_types.json.
CLASSES = {"Crimp": "crimp", "Jug": "jug", "Pinch": "pinch", "Pocket": "pocket", "Slope": "sloper", "Volume": "volume"}


def crop(img, box):
    """Square close-up of the hold in box (x0, y0, x1, y1), SIDE x SIDE pixels. Outside the photo is black."""
    x0, y0, x1, y1 = box
    half = MARGIN * max(x1 - x0, y1 - y0, 2) / 2
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return img.crop((round(cx - half), round(cy - half), round(cx + half), round(cy + half))).resize((SIDE, SIDE))


@functools.lru_cache(maxsize=1)
def _model():
    from ultralytics import YOLO
    return YOLO(WEIGHTS)


def available():
    return os.path.exists(WEIGHTS)


def predict(img, boxes):
    """For each box: [(type id, probability)] for every type, best first."""
    import torch
    if not boxes:
        return []
    model = _model()
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    out = []
    for i in range(0, len(boxes), 64):
        res = model.predict([crop(img, b) for b in boxes[i:i + 64]], imgsz=SIDE, device=device, verbose=False)
        for r in res:
            p = r.probs.data.cpu().tolist()
            out.append(sorted(((CLASSES[r.names[j]], float(v)) for j, v in enumerate(p)), key=lambda t: -t[1]))
    return out
