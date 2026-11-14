"""Depth from one wall photo, for the 3D wall mesh.

Model: Depth Anything V2 Small (depth-anything/Depth-Anything-V2-Small-hf, Apache-2.0).
It gives relative depth: bigger means closer to the camera, with no units.

A straight-on wall photo has the wall itself as a big, nearly flat surface. We
estimate that surface, take it away, and keep what sticks out of it: volumes and
holds. The result is a relief
map, 0 where the wall is flat and 1 for the part that sticks out the most.
"""
import functools
import io
import threading

import numpy as np
import torch
from PIL import Image, ImageFilter, ImageOps

MODEL = "depth-anything/Depth-Anything-V2-Small-hf"
OUT_SIDE = 384          # long side of the relief map sent to the viewer
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
    r = d - ndimage.gaussian_filter(d, 0.05 * max(w, h))
    r -= np.median(r)                               # most of the photo is flat wall
    core = r[h // 10: -h // 10, w // 10: -w // 10]  # scale from the middle, not the floor or the photo edges
    r = np.clip(r / max(np.percentile(core, 99.5), 1e-6), 0, 1)
    img = Image.fromarray((r * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    return np.asarray(img, dtype=np.float32) / 255


def relief_png(image):
    buf = io.BytesIO()
    Image.fromarray((relief(image) * 255).astype(np.uint8)).save(buf, "PNG")
    return buf.getvalue()
