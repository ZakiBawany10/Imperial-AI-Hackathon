# Usage: python timing.py <workdir> <recdir>   (recdir has solve.json + solve_request.json from record.mjs)
# When does the real climber reach each hold of the solved climb?
# YOLO pose per frame -> wrists/ankles; a move "lands" when a matching limb is within
# reach of that hold (mapped photo->video) for a few frames. Writes timing.json.
import cv2, numpy as np, json, sys, os
D = sys.argv[1]; REC = sys.argv[2]
os.chdir(D)
from ultralytics import YOLO
model = YOLO("yolo11n-pose.pt")
H = np.load("H.npy")
solve = json.load(open(f"{REC}/solve.json")); req = json.load(open(f"{REC}/solve_request.json"))
holds = {h["id"]: h for h in req["holds"]}
cap = cv2.VideoCapture("climb.mp4"); fps = cap.get(cv2.CAP_PROP_FPS)
kps = []
i = 0
while True:
    ok, f = cap.read()
    if not ok: break
    r = model(f, verbose=False, conf=0.3)[0]
    if r.keypoints is not None and len(r.keypoints.xy):
        # the biggest person
        boxes = r.boxes.xywh.cpu().numpy(); j = int(np.argmax(boxes[:, 2] * boxes[:, 3]))
        kp = r.keypoints.xy.cpu().numpy()[j]; cf = r.keypoints.conf.cpu().numpy()[j]
        kps.append({"lw": kp[9].tolist(), "rw": kp[10].tolist(), "la": kp[15].tolist(), "ra": kp[16].tolist(),
                    "c": [float(cf[9]), float(cf[10]), float(cf[15]), float(cf[16])], "hip": ((kp[11] + kp[12]) / 2).tolist()})
    else:
        kps.append(None)
    i += 1
json.dump(kps, open("pose.json", "w"))
N = len(kps)
def to_video(pt, fi):
    p = H[fi] @ np.array([pt[0], pt[1], 1.0]); return p[:2] / p[2]
scale = np.linalg.norm(to_video((0, 0), 0) - to_video((100, 0), 0)) / 100  # video px per photo px
times = []; t_prev = 0
for m in solve["moves"]:
    if m["hold"] is None: times.append(None); continue
    h = holds[m["hold"]]
    hand = m["limb"] in ("LH", "RH")
    rad = max(55, 0.75 * max(h["w"], h["h"]) * scale)
    hit = 0; found = None
    for fi in range(t_prev, N):
        k = kps[fi]
        if not k: hit = 0; continue
        pts = [(k["lw"], k["c"][0]), (k["rw"], k["c"][1])] if hand else [(k["la"], k["c"][2]), (k["ra"], k["c"][3])]
        hv = to_video((h["x"], h["y"]), fi)
        near = any(c > 0.3 and np.hypot(p[0] - hv[0], p[1] - hv[1]) < rad for p, c in pts)
        hit = hit + 1 if near else 0
        if hit >= 3: found = fi - 2; break
    times.append(found)
    if found is not None: t_prev = found + 1
    print(m["limb"], m["hold"], "frame", found, "t=%.2f" % (found / fps) if found is not None else "")
json.dump({"fps": fps, "frames": N, "move_frames": times, "scale": scale}, open("timing.json", "w"))
