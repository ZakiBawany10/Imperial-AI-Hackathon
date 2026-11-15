"""Follow a filmed climb onto the wall photo, offline: the same job as the app's live camera
(frontend/src/lib/tracker.ts), for a handheld video, and render it for the demo.

Each video frame is matched onto the wall photo (SIFT + RANSAC homography), so a shaky phone is
fine. A pose model (MediaPipe Pose Landmarker, heavy) finds hands and feet. Out come:
  - <out>.climb.json  every limb that stayed on a route hold for 350 ms, as POST /climbs takes it
  - <out>.mp4         1920x1080: the climb on the left with the next hold ringed on the wall, and on
                      the right the move in big type and the app's plan ticking off. --slow 0.6
                      plays it at 0.6x so there is time to talk over it.

The app's moves are ticked off as in tracker.ts, with two allowances real climbers need: a limb
already on its hold counts, and reaching a later move (up to 2 ahead) ticks off the ones before.

Needs mediapipe, which the server does not (Python 3.12 or older):
  uv venv -p 3.12 mpenv && uv pip install -p mpenv/bin/python mediapipe opencv-python numpy pillow
  mpenv/bin/python demo/track_video.py VIDEO PHOTO SOLVE_REQUEST.json SOLVE.json OUT \
      --model pose_landmarker_heavy.task --fonts DIR_WITH_BARLOW_TTFS [--slow 0.6]
The photo must be the one the hold ids refer to (the app sends photos at 1536x2048).
"""
import argparse
import json
import os
import subprocess

import cv2
import mediapipe as mp
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HOLD_MS = 350
LIMBS = {"LH": (15, 19), "RH": (16, 20), "LF": (29, 31), "RF": (30, 32)}   # wrist+index / heel+toe
BONES = [(11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24), (23, 24),
         (23, 25), (25, 27), (24, 26), (26, 28), (27, 31), (28, 32)]
NAME = {"LH": "Left hand", "RH": "Right hand", "LF": "Left foot", "RF": "Right foot"}
# the app's palette (frontend/src/index.css)
PAPER, INK, MUTED, HAIR = (255, 255, 255), (36, 62, 54), (90, 110, 102), (210, 226, 203)
ACCENT, ACCENT_INK, MINT = (124, 169, 130), (63, 122, 85), (150, 235, 190)
W, H_OUT = 1920, 1080


# ---------------------------------------------------------------- tracking
def track(video, photo_small, s, model):
    sift = cv2.SIFT_create(4000)
    kp_p, de_p = sift.detectAndCompute(cv2.cvtColor(photo_small, cv2.COLOR_BGR2GRAY), None)
    bf = cv2.BFMatcher()
    opts = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=model),
        running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=1)
    pose = mp.tasks.vision.PoseLandmarker.create_from_options(opts)
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frames, Hs, poses = [], [], []
    Hc = None
    while True:
        ok, f = cap.read()
        if not ok:
            break
        t = len(frames) * 1000 / fps
        g = cv2.cvtColor(cv2.resize(f, None, fx=0.5, fy=0.5), cv2.COLOR_BGR2GRAY)
        kp, de = sift.detectAndCompute(g, None)
        if de is not None and len(kp) > 20:
            good = [m for m, m2 in bf.knnMatch(de, de_p, k=2) if m.distance < 0.75 * m2.distance]
            if len(good) >= 25:
                src = np.float32([kp[m.queryIdx].pt for m in good]) * 2
                dst = np.float32([kp_p[m.trainIdx].pt for m in good]) / s
                Hn, inl = cv2.findHomography(src, dst, cv2.RANSAC, 6.0)
                if Hn is not None and inl.sum() >= 20:
                    Hn = Hn / Hn[2, 2]
                    Hc = Hn if Hc is None else 0.5 * Hn + 0.5 * Hc
        res = pose.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,
                                             data=cv2.cvtColor(f, cv2.COLOR_BGR2RGB)), int(t))
        lm = res.pose_landmarks[0] if res.pose_landmarks else None
        poses.append(None if lm is None else np.float32([[p.x * f.shape[1], p.y * f.shape[0]] for p in lm]))
        Hs.append(None if Hc is None else Hc.copy())
        frames.append(f)
    return frames, Hs, poses, fps


def follow(frames, Hs, poses, fps, holds, moves, PH):
    """Per frame: limb points on the photo, how many moves are done; plus the climb record events."""
    reach = lambda h: 0.5 * max(h["w"], h["h"]) + 0.03 * PH
    events, on_hold, cand = [], {}, {}
    since = {}                      # (limb, hold) -> ms it has been there since
    done, completer = 0, {}
    per = []
    for n, (Hm, pv) in enumerate(zip(Hs, poses)):
        t = n * 1000 / fps
        limb_pt = None
        if pv is not None and Hm is not None:
            body = cv2.perspectiveTransform(pv[None], Hm)[0]
            limb_pt = {k: (body[i] + body[j]) / 2 for k, (i, j) in LIMBS.items()}
            for k, p in limb_pt.items():
                best, bd = None, 1e9
                for h in holds.values():
                    d = float(np.hypot(p[0] - h["x"], p[1] - h["y"]))
                    if d <= reach(h) and d < bd:
                        best, bd = h["id"], d
                    key = (k, h["id"])
                    if d <= reach(h):
                        since.setdefault(key, t)
                    else:
                        since.pop(key, None)
                c = cand.get(k)
                if not c or c[0] != best:
                    cand[k] = (best, t)
                elif best is not None and on_hold.get(k) != best and t - c[1] >= HOLD_MS:
                    on_hold[k] = best
                    events.append({"t": round(c[1]), "limb": k, "hold": best})
            while done < len(moves) and moves[done]["hold"] is None:
                done += 1
            for i in range(done, min(done + 3, len(moves))):
                m = moves[i]
                if m["hold"] is None:
                    continue
                pair = ("LH", "RH") if m["limb"][1] == "H" else ("LF", "RF")
                prev = moves[i - 1] if i > 0 else None
                hit = None
                both = all(since.get((k, m["hold"])) is not None and t - since[(k, m["hold"])] >= HOLD_MS for k in pair)
                if prev and prev["hold"] == m["hold"] and both:
                    hit = m["limb"]       # a match: both hands are on the hold
                for k in ([] if hit else pair):
                    if prev and prev["hold"] == m["hold"] and completer.get(i - 1) == k:
                        continue          # a match needs the other hand
                    st = since.get((k, m["hold"]))
                    if st is not None and t - st >= HOLD_MS:
                        hit = k
                        break
                if hit:
                    for j in range(done, i + 1):
                        completer[j] = hit if j == i else None
                    done = i + 1
                    break
            # the last move: a hand that has held the top for a second (the model swaps hands from behind)
            if done == len(moves) - 1 and moves[-1]["hold"] is not None and moves[-1]["limb"][1] == "H":
                top = moves[-1]["hold"]
                if any(since.get((k, top)) is not None and t - since[(k, top)] >= 400 for k in ("LH", "RH")):
                    done = len(moves)
        per.append({"limb_pt": limb_pt, "done": done})
    return per, events


# ---------------------------------------------------------------- drawing
class Fonts:
    def __init__(self, d):
        f = lambda name, size: ImageFont.truetype(os.path.join(d, name), size)
        self.huge = f("BarlowCondensed-Bold.ttf", 150)
        self.big = f("BarlowCondensed-SemiBold.ttf", 64)
        self.label = f("BarlowSemiCondensed-SemiBold.ttf", 30)
        self.body = f("Barlow-Medium.ttf", 34)
        self.row = f("Barlow-SemiBold.ttf", 30)
        self.small = f("Barlow-Medium.ttf", 24)
        self.tag = f("BarlowSemiCondensed-SemiBold.ttf", 44)


def direction(frm, to):
    dx, dy = to[0] - frm[0], to[1] - frm[1]
    if np.hypot(dx, dy) < 60:
        return "right there"
    v = "up" if dy < -0.4 * abs(dx) else ("down" if dy > 0.4 * abs(dx) else "")
    h = "right" if dx > 0.4 * abs(dy) else ("left" if dx < -0.4 * abs(dy) else "")
    return " and ".join(w for w in (v, h) if w) or "across"


def rounded(img, r):
    m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], r, fill=255)
    out = Image.new("RGBA", img.size)
    out.paste(img, (0, 0), m)
    return out


def render(frames, Hs, poses, per, fps, photo, holds, moves, fonts, title, out_raw, slow):
    PH, PW = photo.shape[:2]
    # the plan panel: the photo cropped round the route
    xs = [h["x"] for h in holds.values()]
    ys = [h["y"] for h in holds.values()]
    pad = 0.08 * PH
    x0, x1 = max(0, min(xs) - pad), min(PW, max(xs) + pad)
    y0, y1 = max(0, min(ys) - pad), min(PH, max(ys) + pad)
    ph_h = 600
    ph_w = int(ph_h * (x1 - x0) / (y1 - y0))
    if ph_w > 420:
        ph_w = 420
        cw = (y1 - y0) * ph_w / ph_h
        cx = (x0 + x1) / 2
        x0, x1 = max(0, cx - cw / 2), min(PW, cx + cw / 2)
    crop = photo[int(y0):int(y1), int(x0):int(x1)]
    crop = cv2.cvtColor(cv2.resize(crop, (ph_w, ph_h)), cv2.COLOR_BGR2RGB)
    crop = (crop * 0.6 + 255 * 0.4).astype(np.uint8)
    sx, sy = ph_w / (x1 - x0), ph_h / (y1 - y0)
    to_panel = lambda x, y: (int((x - x0) * sx), int((y - y0) * sy))

    VH, VW = frames[0].shape[:2]
    vh = 1000
    vw = int(VW * vh / VH)
    VX, VY = 96, 40
    RX = VX + vw + 96                     # right column starts here
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                             "-s", f"{W}x{H_OUT}", "-r", str(fps * slow), "-i", "-",
                             "-vf", "fps=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
                             "-movflags", "+faststart", out_raw], stdin=subprocess.PIPE)
    n_out = 0
    for n, (f, Hm, pv, st) in enumerate(zip(frames, Hs, poses, per)):
        tout = n / (fps * slow)
        pulse = 0.5 + 0.5 * np.sin(tout * 2 * np.pi * 1.2)
        done = st["done"]
        nxt = moves[done] if done < len(moves) else None

        # ---- left: the climb, with the next hold ringed on the wall
        v = cv2.cvtColor(f, cv2.COLOR_BGR2RGB)
        vimg = Image.fromarray(v).resize((vw, vh), Image.LANCZOS)
        d = ImageDraw.Draw(vimg, "RGBA")
        k = vw / VW
        if pv is not None:
            for i, j in BONES:
                d.line([tuple(pv[i] * k), tuple(pv[j] * k)], fill=(255, 255, 255, 170), width=5)
            for i, j in BONES:
                d.line([tuple(pv[i] * k), tuple(pv[j] * k)], fill=ACCENT_INK + (230,), width=3)
        if nxt is not None and nxt["hold"] is not None and Hm is not None:
            h = holds[nxt["hold"]]
            Hinv = np.linalg.inv(Hm)
            c = cv2.perspectiveTransform(np.float32([[[h["x"], h["y"]], [h["x"] + h["w"] / 2, h["y"]]]]), Hinv)[0] * k
            r = max(26, abs(c[1][0] - c[0][0]) * 1.4) + 8 * pulse
            if pv is not None:
                i, j = LIMBS[nxt["limb"]]
                lp = (pv[i] + pv[j]) / 2 * k
                dash(d, tuple(lp), tuple(c[0]), (255, 255, 255, 235), 6)
                d.ellipse([lp[0] - 13, lp[1] - 13, lp[0] + 13, lp[1] + 13], fill=MINT + (255,), outline=INK + (255,), width=3)
            for rr, col, wd in ((r + 6, (255, 255, 255, 200), 10), (r, MINT + (255,), 7)):
                d.ellipse([c[0][0] - rr, c[0][1] - rr, c[0][0] + rr, c[0][1] + rr], outline=col, width=wd)
            tag = NAME[nxt["limb"]].upper()
            tw = d.textlength(tag, font=fonts.label)
            bx, by = c[0][0] - tw / 2 - 14, c[0][1] - r - 58
            bx = min(max(bx, 8), vw - tw - 36)
            d.rounded_rectangle([bx, by, bx + tw + 28, by + 44], 22, fill=INK + (240,))
            d.text((bx + 14, by + 5), tag, font=fonts.label, fill=(255, 255, 255))

        canvas = Image.new("RGB", (W, H_OUT), PAPER)
        cd = ImageDraw.Draw(canvas)
        cd.rounded_rectangle([VX - 2, VY - 2, VX + vw + 2, VY + vh + 2], 30, fill=HAIR)
        canvas.paste(rounded(vimg, 28), (VX, VY), rounded(vimg, 28))

        # ---- right: the move in big type
        cd.text((RX, 70), title.upper(), font=fonts.label, fill=MUTED)
        if nxt is None:
            cd.text((RX - 6, 110), "Topped it!", font=fonts.huge, fill=ACCENT_INK)
            cd.text((RX, 290), f"All {len(moves)} moves, as the app planned.", font=fonts.body, fill=INK)
        else:
            cd.text((RX, 120), f"MOVE {done + 1} OF {len(moves)}", font=fonts.label, fill=ACCENT_INK)
            cd.text((RX - 6, 150), NAME[nxt["limb"]], font=fonts.huge, fill=INK)
            if st["limb_pt"] is not None and nxt["hold"] is not None:
                h = holds[nxt["hold"]]
                where = direction(st["limb_pt"][nxt["limb"]], (h["x"], h["y"]))
                sub = f"{where}, to the ringed hold" if where != "right there" else "onto the ringed hold"
            else:
                sub = "to the ringed hold"
            cd.text((RX, 330), sub[0].upper() + sub[1:], font=fonts.big, fill=INK)
        # progress
        seg = (W - 96 - RX - 7 * 10) / len(moves)
        for i in range(len(moves)):
            col = ACCENT_INK if i < done else (MINT if i == done else HAIR)
            x = RX + i * (seg + 10)
            cd.rounded_rectangle([x, 430, x + seg, 444], 7, fill=col)

        # plan panel + move list
        pimg = Image.fromarray(crop.copy())
        pd = ImageDraw.Draw(pimg, "RGBA")
        for i, m in enumerate(moves):
            if m["hold"] is None:
                continue
            h = holds[m["hold"]]
            cx_, cy_ = to_panel(h["x"], h["y"])
            rr = max(12, int(0.6 * max(h["w"], h["h"]) * sx))
            if i < done:
                pd.ellipse([cx_ - rr, cy_ - rr, cx_ + rr, cy_ + rr], fill=ACCENT_INK + (200,))
            elif i == done:
                q = rr + 4 + 4 * pulse
                pd.ellipse([cx_ - q, cy_ - q, cx_ + q, cy_ + q], outline=MINT + (255,), width=6)
                pd.ellipse([cx_ - q - 3, cy_ - q - 3, cx_ + q + 3, cy_ + q + 3], outline=INK + (255,), width=2)
        if st["limb_pt"] is not None:
            for kk, p in st["limb_pt"].items():
                x_, y_ = to_panel(*p)
                pd.ellipse([x_ - 7, y_ - 7, x_ + 7, y_ + 7], fill=INK + (230,), outline=(255, 255, 255, 255), width=2)
        PY = 480
        canvas.paste(rounded(pimg, 20), (RX, PY), rounded(pimg, 20))
        cd.text((RX, PY + ph_h + 12), "The app's plan, on the photo", font=fonts.small, fill=MUTED)
        LX = RX + ph_w + 56
        row_h = min(64, ph_h // max(len(moves), 1))
        for i, m in enumerate(moves):
            y = PY + i * row_h
            if i < done:
                cd.ellipse([LX, y + 6, LX + 36, y + 42], fill=ACCENT_INK)
                cd.line([(LX + 9, y + 25), (LX + 16, y + 32), (LX + 28, y + 16)], fill=PAPER, width=4)
                col = MUTED
            elif i == done:
                cd.ellipse([LX, y + 6, LX + 36, y + 42], fill=MINT, outline=INK, width=2)
                col = INK
            else:
                cd.ellipse([LX, y + 6, LX + 36, y + 42], outline=HAIR, width=3)
                col = MUTED
            cd.text((LX + 52, y + 6), f"{NAME[m['limb']]}", font=fonts.row, fill=col)
        proc.stdin.write(np.asarray(canvas).tobytes())
        n_out += 1
    proc.stdin.close()
    proc.wait()


def render_portrait(frames, Hs, poses, per, fps, holds, moves, fonts, out_raw, slow):
    """1080x1920 like Adam's demo: the climb full frame, the next hold ringed on the wall, and a
    banner with the move in big type."""
    VH, VW = frames[0].shape[:2]
    OW, OHt = 1080, 1920
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                             "-s", f"{OW}x{OHt}", "-r", str(fps * slow), "-i", "-",
                             "-vf", "fps=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
                             "-movflags", "+faststart", out_raw], stdin=subprocess.PIPE)
    k = OW / VW
    for n, (f, Hm, pv, st) in enumerate(zip(frames, Hs, poses, per)):
        tout = n / (fps * slow)
        pulse = 0.5 + 0.5 * np.sin(tout * 2 * np.pi * 1.2)
        done = st["done"]
        nxt = moves[done] if done < len(moves) else None
        img = Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)).resize((OW, int(VH * k)), Image.LANCZOS)
        d = ImageDraw.Draw(img, "RGBA")
        if pv is not None:
            for i, j in BONES:
                d.line([tuple(pv[i] * k), tuple(pv[j] * k)], fill=(255, 255, 255, 170), width=9)
            for i, j in BONES:
                d.line([tuple(pv[i] * k), tuple(pv[j] * k)], fill=ACCENT_INK + (235,), width=5)
        if nxt is not None and nxt["hold"] is not None and Hm is not None:
            h = holds[nxt["hold"]]
            c = cv2.perspectiveTransform(np.float32([[[h["x"], h["y"]], [h["x"] + h["w"] / 2, h["y"]]]]), np.linalg.inv(Hm))[0] * k
            r = max(44, abs(c[1][0] - c[0][0]) * 1.4) + 12 * pulse
            if pv is not None:
                i, j = LIMBS[nxt["limb"]]
                lp = (pv[i] + pv[j]) / 2 * k
                dash(d, tuple(lp), tuple(c[0]), (255, 255, 255, 240), 9, 22, 14)
                d.ellipse([lp[0] - 20, lp[1] - 20, lp[0] + 20, lp[1] + 20], fill=MINT + (255,), outline=INK + (255,), width=4)
            for rr, col, wd in ((r + 9, (255, 255, 255, 210), 14), (r, MINT + (255,), 10)):
                d.ellipse([c[0][0] - rr, c[0][1] - rr, c[0][0] + rr, c[0][1] + rr], outline=col, width=wd)
            tag = NAME[nxt["limb"]].upper()
            f_ = fonts.tag
            tw = d.textlength(tag, font=f_)
            bx = min(max(c[0][0] - tw / 2 - 20, 12), OW - tw - 52)
            by = c[0][1] - r - 84
            d.rounded_rectangle([bx, by, bx + tw + 40, by + 66], 33, fill=INK + (240,))
            d.text((bx + 20, by + 7), tag, font=f_, fill=(255, 255, 255))
        # banner
        d.rectangle([0, 0, OW, 430], fill=PAPER + (238,))
        if nxt is None:
            d.text((60, 70), "ZAKI · BLUE ROUTE", font=fonts.tag, fill=MUTED)
            d.text((54, 130), "Topped it!", font=fonts.huge, fill=ACCENT_INK)
        else:
            d.text((60, 60), f"MOVE {done + 1} OF {len(moves)}  ·  NEXT", font=fonts.tag, fill=ACCENT_INK)
            d.text((54, 120), NAME[nxt["limb"]], font=fonts.huge, fill=INK)
            if st["limb_pt"] is not None and nxt["hold"] is not None:
                h = holds[nxt["hold"]]
                where = direction(st["limb_pt"][nxt["limb"]], (h["x"], h["y"]))
                sub = f"{where}, to the ringed hold" if where != "right there" else "onto the ringed hold"
            else:
                sub = "to the ringed hold"
            d.text((60, 300), sub[0].upper() + sub[1:], font=fonts.big, fill=INK)
        seg = (OW - 120 - 10 * (len(moves) - 1)) / len(moves)
        for i in range(len(moves)):
            col = ACCENT_INK if i < done else (MINT if i == done else HAIR)
            x = 60 + i * (seg + 10)
            d.rounded_rectangle([x, 395, x + seg, 411], 8, fill=col + (255,))
        canvas = Image.new("RGB", (OW, OHt), PAPER)
        canvas.paste(img, (0, 0))
        proc.stdin.write(np.asarray(canvas).tobytes())
    proc.stdin.close()
    proc.wait()


def dash(d, a, b, col, w, on=14, off=10):
    a, b = np.float32(a), np.float32(b)
    L = float(np.linalg.norm(b - a))
    if L < 1:
        return
    u = (b - a) / L
    s = 0.0
    while s < L:
        e = min(s + on, L)
        d.line([tuple(a + u * s), tuple(a + u * e)], fill=col, width=w)
        s += on + off


def main():
    ap = argparse.ArgumentParser()
    for x in ("video", "photo", "req", "solve", "out"):
        ap.add_argument(x)
    ap.add_argument("--model", required=True)
    ap.add_argument("--fonts", required=True)
    ap.add_argument("--title", default="Live camera")
    ap.add_argument("--slow", type=float, default=1.0)
    ap.add_argument("--portrait", action="store_true", help="1080x1920, like Adam's demo")
    a = ap.parse_args()
    req, solve = json.load(open(a.req)), json.load(open(a.solve))
    photo = cv2.imread(a.photo)
    PH, PW = photo.shape[:2]
    s = 1200 / PH
    small = cv2.resize(photo, (round(PW * s), 1200))
    holds = {h["id"]: h for h in req["holds"]}
    moves = solve["moves"]

    frames, Hs, poses, fps = track(a.video, small, s, a.model)
    per, events = follow(frames, Hs, poses, fps, holds, moves, PH)
    if a.portrait:
        render_portrait(frames, Hs, poses, per, fps, holds, moves, Fonts(a.fonts), a.out + ".mp4", a.slow)
    else:
        render(frames, Hs, poses, per, fps, photo, holds, moves, Fonts(a.fonts), a.title, a.out + ".mp4", a.slow)

    rec = {"image": req["image"], "wall_height_m": req.get("wall_height_m", 4.0),
           "climber_height_m": req.get("climber_height_m", 1.75), "strength": req.get("strength", 1.0),
           "holds": req["holds"], "start": req["start"], "finish": req["finish"], "events": events,
           "planned": [{"limb": m["limb"], "hold": m["hold"]} for m in moves],
           "topped": any(e["hold"] in req["finish"] and e["limb"][1] == "H" for e in events), "source": "video"}
    json.dump(rec, open(a.out + ".climb.json", "w"), indent=1)
    marks = [next((n for n, p in enumerate(per) if p["done"] > i), None) for i in range(len(moves))]
    print(f"{len(frames)} frames, {len(events)} events, {per[-1]['done']}/{len(moves)} moves done, topped={rec['topped']}")
    print("move done at (s):", [None if m is None else round(m / fps, 2) for m in marks])


if __name__ == "__main__":
    main()
