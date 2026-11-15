"""Cut the 2-minute demo video, landscape 1920x1080, from Adam's app recording, the followed climb
(track_video.py) and Adam's ghost. Each section is rendered to its own mp4, then joined:

  00-title.mp4    "Ascend" over the climb, blurred
  (Zaki talking goes here: drop a 1920x1080 clip in as 01-zaki.mp4 and re-run join)
  02-app.mp4      the app on the phone, a caption per step, step rail
  03-card.mp4     "Then it climbs it with you."
  04-climb.mp4    track_video.py output (next move in big type)
  05-ghost.mp4    Adam's ghost over the real climb
  06-end.mp4      end card

usage: python make_demo.py HANDOFF_DIR CLIMB_MP4 FONTS_DIR OUT_DIR
"""
import glob
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1920, 1080, 30
PAPER, INK, MUTED, HAIR = (255, 255, 255), (36, 62, 54), (90, 110, 102), (210, 226, 203)
ACCENT_INK, MINT = (63, 122, 85), (150, 235, 190)

HAND, CLIMB, FONTS, OUT = sys.argv[1:5]
os.makedirs(OUT, exist_ok=True)
F = lambda n, s: ImageFont.truetype(os.path.join(FONTS, n), s)
WORD = ImageFont.truetype(os.path.join(FONTS, "JosefinSans.ttf"), 190)
WORD.set_variation_by_axes([700])
HEAD = F("BarlowCondensed-Bold.ttf", 92)
HEAD_L = F("BarlowCondensed-Bold.ttf", 120)
SUB = F("Barlow-Medium.ttf", 38)
LABEL = F("BarlowSemiCondensed-SemiBold.ttf", 30)
RAIL = F("BarlowCondensed-SemiBold.ttf", 52)


def writer(path):
    return subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                             "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
                             "-r", str(FPS), path], stdin=subprocess.PIPE)


def fade(img, i, n, k=9):
    """Fade from/to paper over k frames at both ends."""
    a = min(1.0, (i + 1) / k, (n - i) / k)
    if a >= 1:
        return img
    return Image.blend(Image.new("RGB", img.size, PAPER), img, a)


def rounded_paste(canvas, img, xy, r):
    m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], r, fill=255)
    canvas.paste(img, xy, m)


def frames_of(path):
    cap = cv2.VideoCapture(path)
    while True:
        ok, f = cap.read()
        if not ok:
            return
        yield Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))


def centered(d, y, text, font, fill):
    d.text(((W - d.textlength(text, font=font)) / 2, y), text, font=font, fill=fill)


# ---------------------------------------------------------------- 00 title
def title():
    src = os.path.join(HAND, "sources/climb-IMG_9529.mp4")
    n = int(4.5 * FPS)
    p = writer(f"{OUT}/00-title.mp4")
    for i, f in enumerate(frames_of(src)):
        if i >= n:
            break
        # fill the frame with the portrait climb: cover + blur + paper wash
        s = W / f.width
        bg = f.resize((W, int(f.height * s))).crop((0, int(f.height * s * 0.30), W, int(f.height * s * 0.30) + H))
        bg = bg.filter(ImageFilter.GaussianBlur(14))
        bg = Image.blend(bg, Image.new("RGB", (W, H), PAPER), 0.55)
        d = ImageDraw.Draw(bg)
        t = i / FPS
        up = min(1, t / 0.8)
        y = 330 + 30 * (1 - up) ** 2
        centered(d, y, "Ascend", WORD, INK)
        if t > 0.6:
            centered(d, y + 250, "Point your phone at a wall. Get the climb.", SUB, INK)
        p.stdin.write(np.asarray(fade(bg, i, n)).tobytes())
    p.stdin.close(), p.wait()


# ---------------------------------------------------------------- 02 app
CAPS = [  # (start s, headline, sub-line) on Adam's ascend-demo.mp4 clock
    (0.0, "Take one photo", "of the wall you want to climb"),
    (4.0, "It finds every hold", "95% of holds, in 0.2 seconds"),
    (10.0, "Tap your colour", "no need to tell colours apart"),
    (13.0, "Pick the start and the top", "or use the highest hold"),
    (17.0, "It asks only when unsure", "type of hold, start or top"),
    (24.0, "Set your height", "the moves are worked out for your body"),
    (29.0, "Graded: 5b / V1", "with the hardest move marked"),
    (35.0, "Your climb, in 3D", "balance, effort, chance to top it"),
]
STEPS = [("Photo", 0), ("Holds", 4), ("Route", 10), ("Solve", 24), ("Climb", 29)]


def app():
    src = os.path.join(HAND, "videos/ascend-demo.mp4")
    end = 43.8
    n = int(end * FPS)
    p = writer(f"{OUT}/02-app.mp4")
    ph_h = 1000
    for i, f in enumerate(frames_of(src)):
        if i >= n:
            break
        t = i / FPS
        phone = f.crop((98, 0, 98 + 884, 1920)).resize((int(884 * ph_h / 1920), ph_h), Image.LANCZOS)
        c = Image.new("RGB", (W, H), PAPER)
        d = ImageDraw.Draw(c)
        px = (W - phone.width) // 2
        d.rounded_rectangle([px - 10, 30, px + phone.width + 10, 40 + ph_h], 52, fill=INK)
        rounded_paste(c, phone, (px, 40 - 5), 44)
        # caption, left column, slides in
        k = max(j for j, cap in enumerate(CAPS) if cap[0] <= t)
        st, head, sub = CAPS[k]
        a = min(1, (t - st) / 0.35)
        x = 96 - 24 * (1 - a) ** 2
        col = tuple(int(255 + (v - 255) * a) for v in INK)
        mcol = tuple(int(255 + (v - 255) * a) for v in MUTED)
        lines = wrap(d, head, HEAD, px - 96 - 80)
        y = 380 - 50 * (len(lines) - 1)
        d.text((x, y - 56), f"{k + 1:02d}", font=LABEL, fill=tuple(int(255 + (v - 255) * a) for v in ACCENT_INK))
        for ln in lines:
            d.text((x, y), ln, font=HEAD, fill=col)
            y += 100
        for ln in wrap(d, sub, SUB, px - 96 - 80):
            d.text((x, y + 10), ln, font=SUB, fill=mcol)
            y += 50
        # step rail, right column
        cur = max(j for j, s in enumerate(STEPS) if s[1] <= t)
        rx = px + phone.width + 120
        for j, (name, _) in enumerate(STEPS):
            yy = 300 + j * 100
            on = j == cur
            done = j < cur
            fill = ACCENT_INK if done else (MINT if on else None)
            d.ellipse([rx, yy + 8, rx + 40, yy + 48], fill=fill, outline=INK if on else (ACCENT_INK if done else HAIR), width=3)
            if done:
                d.line([(rx + 10, yy + 28), (rx + 18, yy + 36), (rx + 31, yy + 19)], fill=PAPER, width=4)
            if j < len(STEPS) - 1:
                d.line([(rx + 20, yy + 52), (rx + 20, yy + 104)], fill=ACCENT_INK if done else HAIR, width=3)
            d.text((rx + 64, yy), name, font=RAIL, fill=INK if on else (MUTED if done else HAIR))
        p.stdin.write(np.asarray(fade(c, i, n)).tobytes())
    p.stdin.close(), p.wait()


def wrap(d, text, font, width):
    out, cur = [], ""
    for w in text.split():
        nxt = (cur + " " + w).strip()
        if d.textlength(nxt, font=font) <= width or not cur:
            cur = nxt
        else:
            out.append(cur)
            cur = w
    return out + [cur]


# ---------------------------------------------------------------- cards
def card(name, lines, secs, dark=True):
    n = int(secs * FPS)
    p = writer(f"{OUT}/{name}")
    for i in range(n):
        c = Image.new("RGB", (W, H), INK if dark else PAPER)
        d = ImageDraw.Draw(c)
        fg = PAPER if dark else INK
        y = H / 2 - sum(h for _, _, h in lines) / 2
        for text, font, h in lines:
            col = fg if font is not SUB else ((200, 214, 206) if dark else MUTED)
            centered(d, y, text, font, col)
            y += h
        p.stdin.write(np.asarray(fade(c, i, n)).tobytes())
    p.stdin.close(), p.wait()


# ---------------------------------------------------------------- 05 ghost
def ghost():
    src = os.path.join(HAND, "videos/clips/03-ghost-climb.mp4")
    frames = list(frames_of(src))
    n = len(frames)
    p = writer(f"{OUT}/05-ghost.mp4")
    for i, f in enumerate(frames):
        vh = 1000
        v = f.resize((int(f.width * vh / f.height), vh), Image.LANCZOS)
        c = Image.new("RGB", (W, H), PAPER)
        d = ImageDraw.Draw(c)
        vx = 96
        d.rounded_rectangle([vx - 2, 38, vx + v.width + 2, 42 + vh], 30, fill=HAIR)
        rounded_paste(c, v, (vx, 40), 28)
        rx = vx + v.width + 120
        d.text((rx, 120), "THE PLAN, OVER THE REAL CLIMB", font=LABEL, fill=ACCENT_INK)
        y = 170
        for ln in ("The glowing climber", "is Ascend's beta."):
            d.text((rx - 4, y), ln, font=HEAD_L, fill=INK)
            y += 130
        for ln in ("Worked out from one photo, for a 1.75 m climber,",
                   "before Zaki touched the wall."):
            d.text((rx, y + 30), ln, font=SUB, fill=MUTED)
            y += 52
        p.stdin.write(np.asarray(fade(c, i, n)).tobytes())
    p.stdin.close(), p.wait()


def climb():
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", CLIMB, "-vf", "fade=in:0:9,fade=out:st=%.2f:d=0.3" % (dur(CLIMB) - 0.3),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-r", str(FPS), "-an", f"{OUT}/04-climb.mp4"], check=True)


def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]))


def join():
    parts = sorted(glob.glob(f"{OUT}/0*.mp4"))
    with open(f"{OUT}/list.txt", "w") as f:
        for q in parts:
            f.write(f"file '{os.path.abspath(q)}'\n")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{OUT}/list.txt",
                    "-c", "copy", "-movflags", "+faststart", f"{OUT}/ascend-demo-landscape.mp4"], check=True)
    print("parts:", [(os.path.basename(q), round(dur(q), 1)) for q in parts])
    print("total:", round(dur(f"{OUT}/ascend-demo-landscape.mp4"), 1), "s")


if __name__ == "__main__":
    only = sys.argv[5:] or ["title", "app", "card", "climb", "ghost", "end", "join"]
    if "title" in only: title()
    if "app" in only: app()
    if "card" in only: card("03-card.mp4", [("Then it climbs it with you.", HEAD_L, 140)], 2.6)
    if "climb" in only: climb()
    if "ghost" in only: ghost()
    if "end" in only:
        card("06-end.mp4", [("Ascend", WORD, 230), ("ascend-climb.vercel.app", HEAD, 120),
                            ("Krishna · Adam · Zaki", SUB, 60)], 5.0)
    if "join" in only: join()
