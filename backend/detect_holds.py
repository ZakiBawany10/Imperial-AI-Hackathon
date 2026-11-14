"""Zero-shot hold finder: a gym wall photo in, hold boxes out. No training.

Usage:  python3 detect_holds.py photo.jpg [more.jpg ...]

Model: IDEA-Research/grounding-dino-base (Apache-2.0, ungated), prompted with text.
The photo is cut into overlapping tiles because holds are small in a full-wall shot.
Writes <photo>_holds.jpg (boxes drawn) and <photo>_holds.json (centres and sizes).
"""
import json
import sys
import time

import torch
from PIL import Image, ImageDraw
from torchvision.ops import nms
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

MODEL = "IDEA-Research/grounding-dino-base"
PROMPT = "climbing hold."
TILE = 800            # tile side in pixels
OVERLAP = 200
THRESHOLD = 0.15      # 0.22 found 22 holds on data/gym_photos/uga.jpg; 0.15 finds 95 with few false hits
MAX_BOX_FRAC = 0.35   # drop boxes wider or taller than this share of a tile (walls, mats)


def tiles(w, h):
    step = TILE - OVERLAP
    xs = sorted({min(x, max(w - TILE, 0)) for x in range(0, max(w - OVERLAP, 1), step)})
    ys = sorted({min(y, max(h - TILE, 0)) for y in range(0, max(h - OVERLAP, 1), step)})
    return [(x, y, min(x + TILE, w), min(y + TILE, h)) for y in ys for x in xs]


def detect(img, processor, model, device):
    boxes, scores = [], []
    for (x0, y0, x1, y1) in tiles(*img.size):
        crop = img.crop((x0, y0, x1, y1))
        inputs = processor(images=crop, text=PROMPT, return_tensors="pt").to(device)
        with torch.no_grad():
            out = model(**inputs)
        res = processor.post_process_grounded_object_detection(
            out, inputs.input_ids, threshold=THRESHOLD, text_threshold=THRESHOLD,
            target_sizes=[crop.size[::-1]])[0]
        for b, s in zip(res["boxes"].cpu(), res["scores"].cpu()):
            bw, bh = b[2] - b[0], b[3] - b[1]
            if bw > MAX_BOX_FRAC * TILE or bh > MAX_BOX_FRAC * TILE:
                continue
            boxes.append(b + torch.tensor([x0, y0, x0, y0]))
            scores.append(s)
    if not boxes:
        return []
    boxes, scores = torch.stack(boxes), torch.stack(scores)
    keep = nms(boxes, scores, 0.4)
    return [(boxes[i].tolist(), float(scores[i])) for i in keep]


def main():
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    processor = AutoProcessor.from_pretrained(MODEL)
    model = AutoModelForZeroShotObjectDetection.from_pretrained(MODEL).to(device).eval()
    for path in sys.argv[1:]:
        img = Image.open(path).convert("RGB")
        t = time.time()
        found = detect(img, processor, model, device)
        secs = time.time() - t
        draw = ImageDraw.Draw(img)
        for (x0, y0, x1, y1), s in found:
            draw.rectangle((x0, y0, x1, y1), outline=(255, 0, 255), width=3)
        stem = path.rsplit(".", 1)[0]
        img.save(stem + "_holds.jpg", quality=88)
        json.dump([dict(cx=(b[0] + b[2]) / 2, cy=(b[1] + b[3]) / 2, w=b[2] - b[0], h=b[3] - b[1], score=s)
                   for b, s in found], open(stem + "_holds.json", "w"), indent=1)
        print(f"{path}: {len(found)} holds, {secs:.1f}s on {device}")


if __name__ == "__main__":
    main()
