"""Cut every labelled hold out of the hold-type dataset, one small image per hold.

Usage:  python3 type_data.py

Input:  data/holdtypes/holds.zip, from
        kaggle.com/datasets/diegospaziani/indoor-climbing-gym-hold-classification-dataset (CC BY-SA 4.0).
        Only its Final_Dataset is used: real gym photos. (Raw_Dataset is catalogue shots on white,
        Synthetic_Dataset is those pasted on fake walls.)
Output: data/holdtypes/crops/{train,val,test}/<Class>/*.jpg, the folder layout a classifier trains from.

The dataset stores 648 photos as 2,149 augmented copies, and a third of the photos
have copies in more than one of its own splits. So the split here is redone by
original photo (80/10/10): train gets every copy, val and test get one copy each.
"""
import collections
import hashlib
import io
import os
import zipfile

from PIL import Image, ImageOps

import hold_type

HERE = os.path.dirname(os.path.abspath(__file__))
ZIP = os.path.join(HERE, "data", "holdtypes", "holds.zip")
OUT = os.path.join(HERE, "data", "holdtypes", "crops")
NAMES = ["Crimp", "Jug", "Pinch", "Pocket", "Slope", "Volume"]     # label index order in the dataset

def split_of(photo):
    """Stable 80/10/10 split by original photo name."""
    v = int(hashlib.md5(photo.encode()).hexdigest(), 16) % 10
    return "test" if v == 0 else "val" if v == 1 else "train"

MIN_SIDE = 12        # skip holds smaller than this many pixels: nothing to see


def main():
    z = zipfile.ZipFile(ZIP)
    names = set(z.namelist())
    images = {os.path.splitext(n)[0]: n for n in z.namelist() if n.startswith("Final_Dataset/") and "/images/" in n and not n.endswith("/")}
    counts, seen = collections.Counter(), set()
    for stem, name in sorted(images.items()):
        photo = os.path.basename(name).split(".rf.")[0]
        split = split_of(photo)
        if split != "train" and photo in seen:
            continue
        seen.add(photo)
        label = stem.replace("/images/", "/labels/") + ".txt"
        if label not in names:
            continue
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(z.read(name)))).convert("RGB")
        W, H = img.size
        for i, line in enumerate(z.read(label).decode().splitlines()):
            parts = line.split()
            if len(parts) < 5:
                continue
            c = int(parts[0])
            if len(parts) == 5:
                cx, cy, w, h = (float(v) for v in parts[1:])
                x0, y0, x1, y1 = (cx - w / 2) * W, (cy - h / 2) * H, (cx + w / 2) * W, (cy + h / 2) * H
            else:                                    # polygon: x y x y ...
                xs = [float(v) * W for v in parts[1::2]]
                ys = [float(v) * H for v in parts[2::2]]
                x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
            if min(x1 - x0, y1 - y0) < MIN_SIDE:
                continue
            d = os.path.join(OUT, split, NAMES[c])
            os.makedirs(d, exist_ok=True)
            hold_type.crop(img, (x0, y0, x1, y1)).save(os.path.join(d, f"{os.path.basename(stem)}_{i}.jpg"), quality=90)
            counts[(split, NAMES[c])] += 1
    for k in sorted(counts):
        print(k, counts[k])
    for split in ("train", "val", "test"):
        print(split, sum(v for (s, _), v in counts.items() if s == split), "holds")


if __name__ == "__main__":
    main()
