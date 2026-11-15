"""Re-cut Adam's app recording (portrait 1080x1920) so it is easy to follow: a caption band on top
with one line per step, the phone under it, and the waiting sped up.

usage: python recut_app.py ADAM_DEMO_MP4 FONTS_DIR OUT_MP4
"""
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SRC, FONTS, OUT = sys.argv[1:4]
LAND = sys.argv[4:5] == ["landscape"]
W, H, FPS = (1920, 1080, 30) if LAND else (1080, 1920, 30)
INK, PAPER, MINT, MUTED_ON_INK, ACCENT = (36, 62, 54), (255, 255, 255), (150, 235, 190), (170, 196, 184), (124, 169, 130)
F = lambda n, s: ImageFont.truetype(os.path.join(FONTS, n), s)
HEAD_L, SUB_L = F("BarlowCondensed-Bold.ttf", 128), F("Barlow-Medium.ttf", 48)
HEAD, SUB, LABEL = F("BarlowCondensed-Bold.ttf", 96), F("Barlow-Medium.ttf", 40), F("BarlowSemiCondensed-SemiBold.ttf", 34)

# (source start, source end, speed) on Adam's ascend-demo.mp4 clock
SEGS = [(0.8, 3.9, 1.0), (6.6, 9.9, 1.0), (9.9, 9.9, 0, 1.3), (9.9, 17, 1.0), (17, 24, 1.5), (24, 29.4, 1.0),
        (32.0, 32.0, 0, 1.0), (32.0, 38.5, 1.5)]  # 3.9-6.6 recording seam and 29.4-32.0 old 2D view cut; 3.9-6.6: old-to-new recording seam, cut; speed 0 = hold the frame for n s
# (source time, step label, headline, sub-line)
CAPS = [
    (0.0, "PHOTO", "Take one photo", "of the wall you want to climb"),
    (4.0, "HOLDS", "It finds every hold", "95% of holds, in 0.2 seconds"),
    (10.0, "ROUTE", "Tap your colour", "no need to tell colours apart"),
    (13.0, "ROUTE", "Pick the start and the top", "or use the highest hold"),
    (17.0, "CHECK", "It asks only when unsure", "what each hold is for, and its type"),
    (25.5, "YOU", "Set your height", "the moves are worked out for your body"),
    (29.0, "BETA", "Graded 5b / V1", "every move, for your body"),
    (34.5, "BETA", "Your climb, in 3D", "balance, effort, chance to top it"),
]
STEPS = ["PHOTO", "HOLDS", "ROUTE", "CHECK", "YOU", "BETA"]


def out_times():
    """Output frame -> source time."""
    ts = []
    for a, b, sp, *hold in SEGS:
        if sp == 0:
            ts += [a] * int(round(hold[0] * FPS))
            continue
        n = int(round((b - a) / sp * FPS))
        ts += [a + i * sp / FPS for i in range(n)]
    return ts


def main():
    cap = cv2.VideoCapture(SRC)
    sfps = cap.get(cv2.CAP_PROP_FPS)
    ts = out_times()
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                          "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
                          "-movflags", "+faststart", OUT], stdin=subprocess.PIPE)
    si, frame = -1, None
    ph_h = 1000 if LAND else 1460
    ph_w = int(884 * ph_h / 1920)
    px, py = ((1180, 40) if LAND else ((W - ph_w) // 2, H - ph_h - 40))
    tx, ty = ((160, 330) if LAND else (60, 56))       # step rail; headline under it
    mask = Image.new("L", (ph_w, ph_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, ph_w - 1, ph_h - 1], 46, fill=255)
    last_cap, cap_t0 = None, 0
    for i, t in enumerate(ts):
        want = int(t * sfps)
        while si < want:
            ok, f = cap.read()
            if not ok:
                break
            si += 1
            frame = f
        img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        phone = img.crop((98, 0, 98 + 884, 1920)).resize((ph_w, ph_h), Image.LANCZOS)
        c = Image.new("RGB", (W, H), INK)
        d = ImageDraw.Draw(c)
        d.rounded_rectangle([px - 6, py - 6, px + ph_w + 6, py + ph_h + 6], 52, fill=(58, 88, 78))
        c.paste(phone, (px, py), mask)
        k = max(j for j, cc in enumerate(CAPS) if cc[0] <= t)
        if k != last_cap:
            last_cap, cap_t0 = k, i
        a = min(1.0, (i - cap_t0) / 8)
        _, step, head, sub = CAPS[k]
        lift = int(18 * (1 - a) ** 2)
        mix = lambda col: tuple(int(INK[q] + (col[q] - INK[q]) * a) for q in range(3))
        # step rail
        x = tx
        for s in STEPS:
            on = s == step
            done = STEPS.index(s) < STEPS.index(step)
            col = MINT if on else (ACCENT if done else (80, 108, 98))
            d.text((x, ty), s, font=LABEL, fill=col)
            tw = d.textlength(s, font=LABEL)
            if on:
                d.rounded_rectangle([x, ty + 44, x + tw, ty + 50], 3, fill=MINT)
            x += tw + 34
        hf = HEAD_L if LAND else HEAD
        d.text((tx - 4, ty + 94 + lift), head, font=hf, fill=mix(PAPER))
        d.text((tx, ty + 94 + (150 if LAND else 118) + lift), sub, font=SUB_L if LAND else SUB, fill=mix(MUTED_ON_INK))
        n = len(ts)
        fa = min(1.0, (n - i) / 9)
        if fa < 1:
            c = Image.blend(Image.new("RGB", (W, H), INK), c, fa)
        p.stdin.write(np.asarray(c).tobytes())
    p.stdin.close()
    p.wait()
    print(f"{len(ts) / FPS:.1f} s")


if __name__ == "__main__":
    main()
