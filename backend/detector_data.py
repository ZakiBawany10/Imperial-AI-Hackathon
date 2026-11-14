"""Download part of the ClimbInst hold dataset and convert it for YOLO training.

Usage:  python3 detector_data.py [n_train] [n_val]      (default 300 and 60; test is always all 50)

ClimbInst (huggingface.co/datasets/ClimbVision/ClimbInst, CC BY-NC-SA 4.0) has
1,509 gym wall photos with every hold outlined. It is 4.2 GB, so this takes a
random sample (fixed seed). Each outline becomes a box, and photos are shrunk
to 1600 px on the long side so training reads them quickly.

Writes data/climbinst/yolo/{train,validation,test}/{images,labels}/ and data.yaml.
"""
import json
import os
import random
import sys
from concurrent.futures import ThreadPoolExecutor

from huggingface_hub import HfApi, hf_hub_download
from PIL import Image, ImageOps

REPO = "ClimbVision/ClimbInst"
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "data", "climbinst", "raw")
OUT = os.path.join(HERE, "data", "climbinst", "yolo")
MAX_SIDE = 1600
SEED = 0


def fetch(name):
    return hf_hub_download(REPO, name, repo_type="dataset", local_dir=RAW)


def convert(split, image_name, ann_name):
    stem = os.path.splitext(os.path.basename(image_name))[0]
    dst_img = os.path.join(OUT, split, "images", stem + ".jpg")
    dst_lbl = os.path.join(OUT, split, "labels", stem + ".txt")
    if os.path.exists(dst_img) and os.path.exists(dst_lbl):
        return 0
    ann = json.load(open(os.path.join(RAW, ann_name)))
    W, H = ann["imageWidth"], ann["imageHeight"]
    img = Image.open(os.path.join(RAW, image_name))
    if img.size != (W, H):                       # outlines were drawn on the upright photo
        img = ImageOps.exif_transpose(img)
    if img.size != (W, H):
        print(f"skip {image_name}: photo is {img.size}, annotation says {(W, H)}")
        return 0
    lines = []
    for shape in ann["shapes"]:
        xs = [min(max(p[0], 0), W) for p in shape["points"]]
        ys = [min(max(p[1], 0), H) for p in shape["points"]]
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        if len(xs) < 2 or w < 2 or h < 2:
            continue
        lines.append(f"0 {(min(xs) + w / 2) / W:.6f} {(min(ys) + h / 2) / H:.6f} {w / W:.6f} {h / H:.6f}")
    img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    img.save(dst_img, quality=90)
    open(dst_lbl, "w").write("\n".join(lines) + "\n")
    return len(lines)


def main():
    want = {"train": int(sys.argv[1]) if len(sys.argv) > 1 else 300,
            "validation": int(sys.argv[2]) if len(sys.argv) > 2 else 60,
            "test": 10 ** 9}
    files = HfApi().list_repo_files(REPO, repo_type="dataset")
    for split, n in want.items():
        images = {os.path.splitext(os.path.basename(f))[0]: f for f in files if f.startswith(f"{split}/images/")}
        anns = {os.path.splitext(os.path.basename(f))[0]: f for f in files if f.startswith(f"{split}/annotations/")}
        stems = sorted(set(images) & set(anns))
        stems = random.Random(SEED).sample(stems, min(n, len(stems)))
        for sub in ("images", "labels"):
            os.makedirs(os.path.join(OUT, split, sub), exist_ok=True)
        with ThreadPoolExecutor(8) as pool:
            list(pool.map(fetch, [images[s] for s in stems] + [anns[s] for s in stems]))
            boxes = sum(pool.map(lambda s: convert(split, images[s], anns[s]), stems))
        print(f"{split}: {len(stems)} photos, {boxes} new hold boxes", flush=True)
    open(os.path.join(OUT, "data.yaml"), "w").write(
        f"path: {OUT}\ntrain: train/images\nval: validation/images\ntest: test/images\nnames:\n  0: hold\n")


if __name__ == "__main__":
    main()
