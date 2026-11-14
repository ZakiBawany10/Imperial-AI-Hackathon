"""POST /analyze: a wall photo in, the hold list of the API contract out.

Finding holds: the trained YOLO detector if models/holds.pt exists (see
train_detector.py), otherwise the zero-shot finder in detect_holds.py.
Colour: sampled from the photo.
Type: the trained classifier if models/hold_type.pt exists (see train_type.py).
Without it each hold gets a rough guess from its size and shape, which is never
confident, so every hold is flagged for the user to confirm.
"""
import functools
import json
import os
import threading

import numpy as np
import torch
from PIL import Image, ImageOps

import detect_holds
import hold_type

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_SIDE = 1920          # larger photos are shrunk for zero-shot detection; results are scaled back
YOLO_WEIGHTS = os.path.join(HERE, "models", "holds.pt")
YOLO_TILED = os.environ.get("BETACRUX_TILED", "1") == "1"   # tiled finds 95% of test holds, plain 91%
REVIEW_BELOW = 0.6       # top type guess under this confidence -> needs_review
_lock = threading.Lock()


@functools.lru_cache(maxsize=1)
def hold_types():
    return json.load(open(os.path.join(HERE, "hold_types.json")))


@functools.lru_cache(maxsize=1)
def _detector():
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    processor = AutoProcessor.from_pretrained(detect_holds.MODEL)
    model = AutoModelForZeroShotObjectDetection.from_pretrained(detect_holds.MODEL).to(device).eval()
    return processor, model, device


def _find(image):
    """[(box in pixels of image, score)] from whichever detector is available."""
    if os.path.exists(YOLO_WEIGHTS):
        import detector
        return detector.detect(image, YOLO_WEIGHTS, tiled=YOLO_TILED)
    W, H = image.size
    scale = min(1.0, MAX_SIDE / max(W, H))
    small = image.resize((round(W * scale), round(H * scale))) if scale < 1 else image
    processor, model, device = _detector()
    return [([v / scale for v in box], score) for box, score in detect_holds.detect(small, processor, model, device)]


def warm():
    with _lock:
        if os.path.exists(YOLO_WEIGHTS):
            import detector
            detector._model(YOLO_WEIGHTS)
        else:
            _detector()


def _color(arr, box):
    """Hex colour of the hold: the most colourful pixels in the middle of the box.
    Shadows, chalk and the wall are dull, so the vivid 40% is mostly hold."""
    h, w = arr.shape[:2]
    x0, y0, x1, y1 = (int(round(v)) for v in box)
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w), min(y1, h)
    mx, my = int(0.2 * (x1 - x0)), int(0.2 * (y1 - y0))
    inner = arr[y0 + my:max(y1 - my, y0 + my + 1), x0 + mx:max(x1 - mx, x0 + mx + 1)].reshape(-1, 3).astype(float)
    vivid = inner.max(axis=1) - inner.min(axis=1)
    r, g, b = np.median(inner[vivid >= np.percentile(vivid, 60)], axis=0)
    return "#%02x%02x%02x" % (int(r), int(g), int(b))


def _type_guess(w, h, image_h):
    """Top three type guesses from box size and shape alone. A rough prior, not a trained model."""
    size = max(w, h) / image_h
    if size > 0.10:
        g = [("volume", 0.50), ("sloper", 0.30), ("jug", 0.20)]
    elif size > 0.033:
        g = [("pinch", 0.45), ("jug", 0.35), ("sloper", 0.20)] if h > 1.4 * w else \
            [("jug", 0.45), ("sloper", 0.30), ("pinch", 0.25)]
    elif size > 0.02:
        g = [("crimp", 0.40), ("jug", 0.35), ("pocket", 0.25)]
    else:
        g = [("foot", 0.50), ("crimp", 0.35), ("pocket", 0.15)]
    return [{"type": t, "p": p} for t, p in g]


FOOT_BELOW = 0.02        # holds smaller than this share of the photo height are probably foot chips


def _type_guesses(image, boxes):
    """Top three [{"type", "p"}] per box, best first."""
    H = image.size[1]
    sizes = [(x1 - x0, y1 - y0) for x0, y0, x1, y1 in boxes]
    if not hold_type.available():
        return [_type_guess(w, h, H) for w, h in sizes]
    out = []
    for (w, h), ranked in zip(sizes, hold_type.predict(image, boxes)):
        if max(w, h) / H <= FOOT_BELOW:
            # The classifier has no foot class; a tiny hold is most likely one.
            ranked = [("foot", 0.5)] + [(t, p * 0.5) for t, p in ranked]
        out.append([{"type": t, "p": round(p, 2)} for t, p in ranked[:3]])
    return out


def analyze(image):
    """image: a PIL image. Returns the POST /analyze response dict."""
    image = ImageOps.exif_transpose(image).convert("RGB")   # match how a browser shows a phone photo
    W, H = image.size
    with _lock:
        found = _find(image)
    found = sorted(found, key=lambda f: (f[0][1] + f[0][3], f[0][0] + f[0][2]))
    with _lock:
        all_guesses = _type_guesses(image, [box for box, _ in found])
    arr = np.asarray(image)
    quality = {t["id"]: t["quality"] for t in hold_types()}
    holds = []
    for (box, score), guesses in zip(found, all_guesses):
        x0, y0, x1, y1 = box
        w, h = x1 - x0, y1 - y0
        top = guesses[0]
        holds.append({"id": len(holds), "x": round((x0 + x1) / 2), "y": round((y0 + y1) / 2),
                      "w": round(w), "h": round(h), "type": top["type"], "quality": quality[top["type"]],
                      "color": _color(arr, (x0, y0, x1, y1)), "score": round(score, 2),
                      "needs_review": top["p"] < REVIEW_BELOW, "suggestions": guesses})
    return {"image": {"w": W, "h": H}, "holds": holds}
