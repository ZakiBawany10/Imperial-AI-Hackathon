"""The 3D section of the demo: Adam's Play-screen recording zoomed in on the 3D viewer so the climber
fills the frame, with a caption per beat.

usage: python three_d.py 04-3d-beta.mp4 FONTS_DIR OUT_MP4 [landscape]
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
INK, PAPER, MINT, MUTED_ON_INK = (36, 62, 54), (255, 255, 255), (150, 235, 190), (170, 196, 184)
F = lambda n, s: ImageFont.truetype(os.path.join(FONTS, n), s)
HEAD = F("BarlowCondensed-Bold.ttf", 104 if LAND else 96)
SUB = F("Barlow-Medium.ttf", 40)
LABEL = F("BarlowSemiCondensed-SemiBold.ttf", 34)
CROP = (210, 392, 870, 905) if LAND else (250, 392, 830, 905)   # the 3D wall inside the phone recording
START, END = 2.4, 14.4              # from "3D wall on" to the end of the clip
CAPS = [  # (s into the section, headline lines, sub-line lines)
    (0.0, ["Your climb,", "in 3D"], ["life-size, for your height", "and strength"]),
    (4.0, ["Every move,", "for your body"], ["balance point and effort", "on every limb"]),
    (8.0, ["The wall,", "raised in 3D"], ["from the one photo", "you took"]),
]


def main():
    cap = cv2.VideoCapture(SRC)
    sfps = cap.get(cv2.CAP_PROP_FPS)
    cap.set(cv2.CAP_PROP_POS_MSEC, START * 1000)
    n = int((END - START) * FPS)
    cw, ch = CROP[2] - CROP[0], CROP[3] - CROP[1]
    if LAND:
        vh = 940
        vw = int(cw * vh / ch)
        vx, vy = W - vw - 70, (H - vh) // 2
        tx, ty = 96, 330
    else:
        vw = W - 60
        vh = int(ch * vw / cw)
        vx, vy = 30, 560 + (1920 - 560 - vh) // 2 - 20
        tx, ty = 60, 90
    mask = Image.new("L", (vw, vh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, vw - 1, vh - 1], 36, fill=255)
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                          "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
                          "-movflags", "+faststart", OUT], stdin=subprocess.PIPE)
    frame, si = None, int(START * sfps) - 1
    last, t0 = None, 0
    for i in range(n):
        want = int((START + i / FPS) * sfps)
        while si < want:
            ok, f = cap.read()
            if not ok:
                break
            si += 1
            frame = f
        img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).crop(CROP)
        # a slow push-in over the section
        z = 1 + 0.06 * i / n
        zw, zh = cw / z, ch / z
        img = img.crop(((cw - zw) / 2, (ch - zh) * 0.45, (cw + zw) / 2, (ch - zh) * 0.45 + zh)).resize((vw, vh), Image.LANCZOS)
        c = Image.new("RGB", (W, H), INK)
        d = ImageDraw.Draw(c)
        d.rounded_rectangle([vx - 6, vy - 6, vx + vw + 6, vy + vh + 6], 42, fill=(58, 88, 78))
        c.paste(img, (vx, vy), mask)
        t = i / FPS
        k = max(j for j, cc in enumerate(CAPS) if cc[0] <= t)
        if k != last:
            last, t0 = k, i
        a = min(1.0, (i - t0) / 8)
        mix = lambda col: tuple(int(INK[q] + (col[q] - INK[q]) * a) for q in range(3))
        lift = int(18 * (1 - a) ** 2)
        _, heads, subs = CAPS[k]
        d.text((tx, ty - 60), "3D BETA", font=LABEL, fill=MINT)
        y = ty + lift
        for ln in heads:
            d.text((tx - 4, y), ln, font=HEAD, fill=mix(PAPER))
            y += 108
        y += 14
        for ln in subs:
            d.text((tx, y), ln, font=SUB, fill=mix(MUTED_ON_INK))
            y += 52
        fa = min(1.0, (i + 1) / 9, (n - i) / 9)
        if fa < 1:
            c = Image.blend(Image.new("RGB", (W, H), INK), c, fa)
        p.stdin.write(np.asarray(c).tobytes())
    p.stdin.close()
    p.wait()
    print(f"{n / FPS:.1f} s")


if __name__ == "__main__":
    main()
