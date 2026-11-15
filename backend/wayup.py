"""Real climbers' sequences from "The Way Up" (Zenodo record 15196867, CC BY 4.0).

22 recorded climbs by 11 people (1.56 to 1.83 m tall, first-timer to 15 years' experience) on
two routes of an 8.5 m vertical indoor wall. For every hand and foot: which hold, from which
video frame to which. A calibration per video turns hold boxes into centimetres on the wall.

Only the small annotation files are kept (data/wayup/, about 1 MB): get them with
    python3 wayup.py fetch
which reads them out of the 21 GB dataset zip over HTTP without downloading the videos.

    climbs()  -> list of climbs, each:
      {"id": "p1-green", "person", "route", "height_m", "years", "expert",
       "holds": [{"x", "y" (metres, y up), "w", "h", "foot_only"}],
       "events": [(frame, limb "LH"/"RH"/"LF"/"RF", hold index or None for the bare wall)],
       "hands": [(limb, hold)] the order the hands went to holds, repeats removed}
"""
import csv
import io
import json
import os
import re
import sys
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data", "wayup")
URL = "https://zenodo.org/api/records/15196867/files/dataset.zip/content"
EXPERT_YEARS = 5          # climbing this many years or more counts as an expert


def _years(text):
    t = text.lower()
    if "more than 10" in t:
        return 12
    m = re.findall(r"\d+", t)
    return (int(m[0]) + int(m[-1])) / 2 if m else 0.5


def _homography(path):
    """Image pixels -> wall metres. Fitted from the bolt reference points. Some files list the two
    top points in swapped order (which twists the given matrix), so the points are paired up again
    here: in each row of bolts the image points, left to right, go with the wall points, left to right."""
    import numpy as np
    d = json.load(open(path))
    img, world = [tuple(p) for p in d["img_coords"]], [tuple(p[:2]) for p in d["world_coords"]]
    pairs = []
    for wy in sorted({w[1] for w in world}):
        ws = sorted((w for w in world if w[1] == wy), key=lambda w: w[0])
        # image points of this row: the same number of points, nearest in image height to where this row sits
        idx = [i for i, w in enumerate(world) if w[1] == wy]
        ims = sorted((img[i] for i in idx), key=lambda q: q[0])
        pairs += list(zip(ims, ws))
    A = []
    for (x, y), (X, Y) in pairs:
        A.append([x, y, 1, 0, 0, 0, -X * x, -X * y, -X])
        A.append([0, 0, 0, x, y, 1, -Y * x, -Y * y, -Y])
    H = (np.linalg.svd(np.asarray(A, float))[2][-1].reshape(3, 3)).tolist()

    def to_world(x, y):
        X = H[0][0] * x + H[0][1] * y + H[0][2]
        Y = H[1][0] * x + H[1][1] * y + H[1][2]
        W = H[2][0] * x + H[2][1] * y + H[2][2]
        return X / W / 100.0, Y / W / 100.0           # centimetres -> metres; y already up the wall
    return to_world


def climbs():
    people = {}
    rows = list(csv.reader(open(os.path.join(DATA, "participant_form_data.csv"), encoding="utf-8-sig")))
    for r in rows[1:]:
        if r and r[0].strip():
            people[r[0].strip()] = {"height_m": float(r[2]) / 100, "years": _years(r[4])}
    out = []
    for folder in sorted(os.listdir(DATA)):
        if not re.fullmatch(r"p\d+[ab]?", folder):
            continue
        person = re.sub(r"[ab]$", "", folder[1:])
        for route in ("green", "orange"):
            base = os.path.join(DATA, folder, route)
            if not os.path.exists(base + "_holdUsage.csv"):
                continue
            to_world = _homography(base + "_bolt_holes.json")
            holds = []
            for h in json.load(open(base + "_routeAnnotation.json"))["holds"]:
                (x0, y0), (x1, y1) = (h["topLeftCorner"]["x"], h["topLeftCorner"]["y"]), (h["bottomRightCorner"]["x"], h["bottomRightCorner"]["y"])
                cx, cy = to_world((x0 + x1) / 2, (y0 + y1) / 2)
                ax, ay = to_world(x0, y1)
                bx, by = to_world(x1, y0)
                holds.append({"x": cx, "y": cy, "w": abs(bx - ax), "h": abs(by - ay), "foot_only": bool(h["isFoothold"])})
            events = []
            for r in list(csv.reader(open(base + "_holdUsage.csv")))[1:]:
                if not r or not r[0].strip():
                    continue
                m = re.fullmatch(r"\s*([lr])([hf])\s*(\w+)\s*", r[0])
                if not m:
                    continue
                limb = m.group(1).upper() + m.group(2).upper()
                hold = None if m.group(3) == "w" else int(m.group(3))
                if hold is not None and hold >= len(holds):
                    continue
                events.append((int(r[1]), limb, hold))
            events.sort(key=lambda e: e[0])
            hands, last = [], {}
            for _, limb, hold in events:
                if limb[1] == "H" and hold is not None and last.get(limb) != hold:
                    hands.append((limb, hold))
                    last[limb] = hold
            p = people.get(person, {"height_m": 1.73, "years": 1})
            out.append({"id": f"{folder}-{route}", "person": person, "route": route, "height_m": p["height_m"],
                        "years": p["years"], "expert": p["years"] >= EXPERT_YEARS,
                        "holds": holds, "events": events, "hands": hands})
    return out


class _HttpFile(io.RawIOBase):
    def __init__(self, url):
        r = urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers={"User-Agent": "research-fetch"}))
        self.url, self.size, self.pos = r.url, int(r.headers["Content-Length"]), 0
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def readinto(self, b):
        if self.pos >= self.size:
            return 0
        end = min(self.pos + len(b), self.size) - 1
        data = urllib.request.urlopen(urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}", "User-Agent": "research-fetch"})).read()
        b[:len(data)] = data
        self.pos += len(data)
        return len(data)


def fetch():
    z = zipfile.ZipFile(io.BufferedReader(_HttpFile(URL), buffer_size=1 << 20))
    for name in z.namelist():
        if name.endswith(("holdUsage.csv", "routeAnnotation.json", "bolt_holes.json")) or name in ("README.md", "participant_form_data.csv"):
            z.extract(name, DATA)
    print("annotations saved to", DATA)


if __name__ == "__main__":
    if sys.argv[1:] == ["fetch"]:
        fetch()
    else:
        for c in climbs():
            print(c["id"], f'{c["height_m"]:.2f} m', f'{c["years"]:g} y', "expert" if c["expert"] else "", len(c["holds"]), "holds,",
                  len(c["hands"]), "hand moves, top", f'{max(h["y"] for h in c["holds"]):.1f} m')
