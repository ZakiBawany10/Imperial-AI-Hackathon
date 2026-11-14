"""POST /analyze: a wall photo in, the hold list of the API contract out.

Finding holds: the zero-shot finder in detect_holds.py (no training).
Colour: sampled from the photo.
Type: there is no trained type model yet, so each hold gets a rough guess from
its size and shape and is always flagged for the user to confirm.
"""
import functools
import json
import os
import threading

import numpy as np
import torch
from PIL import Image, ImageOps

import detect_holds

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_SIDE = 1920          # larger photos are shrunk for detection; results are scaled back
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


def warm():
    with _lock:
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


def analyze(image):
    """image: a PIL image. Returns the POST /analyze response dict."""
    image = ImageOps.exif_transpose(image).convert("RGB")   # match how a browser shows a phone photo
    W, H = image.size
    scale = min(1.0, MAX_SIDE / max(W, H))
    small = image.resize((round(W * scale), round(H * scale))) if scale < 1 else image
    with _lock:
        processor, model, device = _detector()
        found = detect_holds.detect(small, processor, model, device)
    arr = np.asarray(image)
    quality = {t["id"]: t["quality"] for t in hold_types()}
    holds = []
    for box, score in sorted(found, key=lambda f: (f[0][1] + f[0][3], f[0][0] + f[0][2])):
        x0, y0, x1, y1 = (v / scale for v in box)
        w, h = x1 - x0, y1 - y0
        guesses = _type_guess(w, h, H)
        top = guesses[0]
        holds.append({"id": len(holds), "x": round((x0 + x1) / 2), "y": round((y0 + y1) / 2),
                      "w": round(w), "h": round(h), "type": top["type"], "quality": quality[top["type"]],
                      "color": _color(arr, (x0, y0, x1, y1)), "score": round(score, 2),
                      "needs_review": top["p"] < REVIEW_BELOW, "suggestions": guesses})
    return {"image": {"w": W, "h": H}, "holds": holds}
