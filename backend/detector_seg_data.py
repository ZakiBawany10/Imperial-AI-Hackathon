"""Make hold-OUTLINE training labels from the ClimbInst sample already downloaded by detector_data.py.

Usage:  python3 detector_seg_data.py

detector_data.py reduced every hold outline to a box. This keeps the outline, so a
model can learn each hold's shape (used for colour, route grouping and the 3D view).
Reads data/climbinst/raw/ and the shrunk photos in data/climbinst/yolo/, writes
data/climbinst/yolo_seg/{train,validation,test}/{images,labels}/ and data.yaml.
Photos are hard-linked, not copied.
"""
import glob
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "data", "climbinst", "raw")
BOX = os.path.join(HERE, "data", "climbinst", "yolo")
OUT = os.path.join(HERE, "data", "climbinst", "yolo_seg")


def main():
    for split in ("train", "validation", "test"):
        for sub in ("images", "labels"):
            os.makedirs(os.path.join(OUT, split, sub), exist_ok=True)
        photos = holds = 0
        for img in sorted(glob.glob(os.path.join(BOX, split, "images", "*.jpg"))):
            stem = os.path.splitext(os.path.basename(img))[0]
            ann_path = os.path.join(RAW, split, "annotations", stem + ".json")
            if not os.path.exists(ann_path):
                continue
            ann = json.load(open(ann_path))
            W, H = ann["imageWidth"], ann["imageHeight"]
            lines = []
            for shape in ann["shapes"]:
                pts = [(min(max(x, 0), W) / W, min(max(y, 0), H) / H) for x, y in shape["points"]]
                if len(pts) < 3:
                    continue
                xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                if (max(xs) - min(xs)) * W < 2 or (max(ys) - min(ys)) * H < 2:
                    continue
                lines.append("0 " + " ".join(f"{x:.6f} {y:.6f}" for x, y in pts))
            dst = os.path.join(OUT, split, "images", stem + ".jpg")
            if not os.path.exists(dst):
                os.link(img, dst)
            open(os.path.join(OUT, split, "labels", stem + ".txt"), "w").write("\n".join(lines) + "\n")
            photos += 1
            holds += len(lines)
        print(f"{split}: {photos} photos, {holds} hold outlines")
    open(os.path.join(OUT, "data.yaml"), "w").write(
        f"path: {OUT}\ntrain: train/images\nval: validation/images\ntest: test/images\nnames:\n  0: hold\n")


if __name__ == "__main__":
    main()
