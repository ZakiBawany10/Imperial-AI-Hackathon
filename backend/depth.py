"""Depth from one wall photo, for the 3D wall mesh.

Model: Depth Anything V2 Base (depth-anything/Depth-Anything-V2-Base-hf, CC BY-NC 4.0).
It gives relative depth: bigger means closer to the camera, with no units.

A straight-on wall photo has the wall itself as a big, nearly flat surface. We
estimate that surface, take it away, and keep what sticks out of it: volumes and
holds. The result is a relief
map, 0 where the wall is flat and 1 for the part that sticks out the most.
"""
import functools
import io
import os
import threading

import numpy as np
import torch
from PIL import Image, ImageFilter, ImageOps

MODEL = "depth-anything/Depth-Anything-V2-Base-hf"   # Base: sharper edges than Small; about 0.5 s a photo on the laptop GPU
OUT_SIDE = 512          # long side of the relief map sent to the viewer
_lock = threading.Lock()


@functools.lru_cache(maxsize=1)
def _model():
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    return AutoImageProcessor.from_pretrained(MODEL), AutoModelForDepthEstimation.from_pretrained(MODEL).to(device).eval(), device


def relief(image):
    """image: PIL image. Returns a float32 array (OUT_SIDE on the long side), 0 = flat wall, 1 = sticks out most."""
    image = ImageOps.exif_transpose(image).convert("RGB")
    with _lock:
        processor, model, device = _model()
        inputs = processor(images=image, return_tensors="pt").to(device)
        with torch.no_grad():
            d = model(**inputs).predicted_depth
    W, H = image.size
    s = OUT_SIDE / max(W, H)
    w, h = max(round(W * s), 2), max(round(H * s), 2)
    d = torch.nn.functional.interpolate(d[:, None], size=(h, w), mode="bicubic", align_corners=False)[0, 0].cpu().numpy()

    # The wall: what the depth would be with nothing on it, taken as a wide blur of the depth.
    # Volumes and holds are much smaller than the blur, so depth minus blur is what sticks out.
    from scipy import ndimage
    r = d - ndimage.gaussian_filter(d, 0.02 * max(w, h))      # 0.02 scored best of 0.012-0.12 (eval_depth.py)
    r -= np.median(r)                               # most of the photo is flat wall
    core = r[h // 10: -h // 10, w // 10: -w // 10]  # scale from the middle, not the floor or the photo edges
    r = np.clip(r / max(np.percentile(core, 99.5), 1e-6), 0, 1)
    # The bottom of a wall photo is usually floor and mats, which the filter mistakes for relief.
    fade = np.clip((h - 1 - np.arange(h)) / (0.08 * h), 0, 1) ** 2
    r *= fade[:, None]
    # Depth alone raises only about two thirds of the holds and flattens big shapes (eval_depth.py).
    # The hold-outline model knows exactly where each hold is: each one becomes a smooth dome over
    # its own outline, higher for bigger holds, and the depth fills in the rest of the wall.
    r = np.maximum(0.6 * r, _hold_domes(image, (h, w)))
    img = Image.fromarray((np.clip(r, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
    return np.asarray(img, dtype=np.float32) / 255


SEG_WEIGHTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "holds_seg.pt")


@functools.lru_cache(maxsize=1)
def _seg():
    from ultralytics import YOLO
    return YOLO(SEG_WEIGHTS)


def hold_dome_height(size):
    """Dome height (relief units, 1.0 = RELIEF_M in the viewer, about 0.32 m) for a hold whose
    area's square root is `size` as a share of the photo's long side: small holds about 5 cm,
    big shapes up to about 25 cm."""
    return min(0.8, 0.12 + 3.0 * size)


def _hold_domes(image, shape):
    if not os.path.exists(SEG_WEIGHTS):
        return np.zeros(shape, np.float32)
    h, w = shape
    res = _seg().predict(image, imgsz=832, conf=0.25, retina_masks=True, max_det=600, verbose=False,
                         device="mps" if torch.backends.mps.is_available() else "cpu")[0]
    out = np.zeros(shape, np.float32)
    if res.masks is None:
        return out
    from scipy import ndimage
    for m in res.masks.data.cpu().numpy():
        m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize((w, h))) > 127
        if m.sum() < 4:
            continue
        dist = ndimage.distance_transform_edt(m)
        out = np.maximum(out, hold_dome_height(np.sqrt(m.sum()) / max(h, w)) * np.sqrt(dist / dist.max()))
    return out


def relief_png(image):
    buf = io.BytesIO()
    Image.fromarray((relief(image) * 255).astype(np.uint8)).save(buf, "PNG")
    return buf.getvalue()
