"""Technical slides for the demo video, 1920x1080, in the app's look. Numbers from docs and the
Devpost write-up (held-out data only).

usage: python tech_slides.py FONTS_DIR DETECTION_JPG OUT_DIR
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FONTS, DET, OUT = sys.argv[1:4]
os.makedirs(OUT, exist_ok=True)
W, H = 1920, 1080
INK, PAPER, MUTED, HAIR = (36, 62, 54), (255, 255, 255), (90, 110, 102), (210, 226, 203)
ACC, MINT, ON_INK = (63, 122, 85), (150, 235, 190), (170, 196, 184)
F = lambda n, s: ImageFont.truetype(os.path.join(FONTS, n), s)
EYE, H1, H2 = F("BarlowSemiCondensed-SemiBold.ttf", 34), F("BarlowCondensed-Bold.ttf", 112), F("BarlowCondensed-Bold.ttf", 64)
BIG, BODY, SMALL = F("BarlowCondensed-Bold.ttf", 132), F("Barlow-Medium.ttf", 38), F("Barlow-Medium.ttf", 30)
MATH = ImageFont.truetype("/System/Library/Fonts/Supplemental/STIXTwoText.ttf", 60)
MATHS = ImageFont.truetype("/System/Library/Fonts/Supplemental/STIXTwoText.ttf", 36)
CODE = F("Barlow-SemiBold.ttf", 46)
LBL = F("BarlowSemiCondensed-SemiBold.ttf", 30)


def base(dark=False):
    c = Image.new("RGB", (W, H), INK if dark else PAPER)
    return c, ImageDraw.Draw(c)


def head(d, eyebrow, title, dark=False, y=88):
    d.text((110, y), eyebrow.upper(), font=EYE, fill=MINT if dark else ACC)
    d.text((104, y + 44), title, font=H1, fill=PAPER if dark else INK)


def stat(d, x, y, big, label, sub=None, dark=False, col=None):
    d.text((x, y), big, font=BIG, fill=col or (MINT if dark else ACC))
    d.text((x + 4, y + 150), label, font=BODY, fill=PAPER if dark else INK)
    if sub:
        d.text((x + 4, y + 198), sub, font=SMALL, fill=ON_INK if dark else MUTED)


def card(d, x, y, w, h, dark=False):
    d.rounded_rectangle([x, y, x + w, y + h], 26, fill=(48, 78, 68) if dark else (246, 250, 244), outline=None if dark else HAIR, width=2)


def foot(d, text, dark=False):
    d.text((110, H - 96), text, font=SMALL, fill=ON_INK if dark else MUTED)


# 1. seeing the wall ------------------------------------------------------------------------
c, d = base()
det = Image.open(DET).convert("RGB")
det = det.resize((int(det.width * 960 / det.height), 960), Image.LANCZOS)
m = Image.new("L", det.size, 0)
ImageDraw.Draw(m).rounded_rectangle([0, 0, det.width - 1, det.height - 1], 28, fill=255)
c.paste(det, (W - det.width - 70, 60), m)
head(d, "Seeing the wall · 3 models we trained", "Every hold,\nfound and named")
d.text((104, 132), "", font=H1)
y = 420
for big, lab, sub in (("95%", "of holds found", "YOLO11s fine-tuned on ClimbInst · zero-shot: 38%"),
                      ("98%", "right type in the top 3", "YOLO11n classifier · top guess 87% · always-jug 42%")):
    stat(d, 110, y, big, lab, sub)
    y += 270
foot(d, "+ YOLO11s-seg traces each hold's outline · 0.2 s per photo · held-out test photos")
c.save(f"{OUT}/t1-wall.png")

# 2. safest, not shortest --------------------------------------------------------------------
c, d = base()
head(d, "Fitting the climb to you", "Safest, not shortest")
card(d, 110, 380, 800, 520)
d.text((160, 420), "1  ·  YOUR BODY", font=LBL, fill=ACC)
d.text((160, 480), "s = 1.75 m / h", font=MATH, fill=INK)
d.text((160, 580), "The wall is rescaled to your height,\nso every reach is your reach.\nStrength scales every grip limit.", font=BODY, fill=MUTED, spacing=14)
card(d, 1010, 380, 800, 520)
d.text((1060, 420), "2  ·  THE SEARCH", font=LBL, fill=ACC)
d.text((1060, 480), "c = −log(1 − p", font=MATH, fill=INK)
_w = d.textlength("c = −log(1 − p", font=MATH)
d.text((1060 + _w, 506), "fall", font=MATHS, fill=INK)
d.text((1060 + _w + d.textlength("fall", font=MATHS) + 4, 480), ")", font=MATH, fill=INK)
d.text((1060, 575), "Σ c = −log Π (1 − p fall)", font=MATHS, fill=MUTED)
d.text((1060, 630), "per move. Summed, the shortest path is\nexactly the sequence most likely\nto reach the top.", font=BODY, fill=MUTED, spacing=14)
foot(d, "Feet are planned for every hand position: onto route holds, or smearing on bare wall.")
c.save(f"{OUT}/t2-solver.png")

# 3. physics --------------------------------------------------------------------------------
c, d = base(dark=True)
head(d, "The physics engine", "Every position is a\nbalance problem", dark=True)
card(d, 110, 470, 860, 400, dark=True)
d.text((160, 505), "ΣF + mg = 0", font=MATH, fill=PAPER)
d.text((160, 580), "Σ r × F = 0", font=MATH, fill=PAPER)
d.text((160, 670), "Each force only where its hold allows:\njug any way · crimp down · sloper straight down.\nOne non-negative least squares solve.", font=SMALL, fill=ON_INK, spacing=12)
x = 1060
stat(d, x, 150, "50 µs", "per body position", "grip limit = hold quality × your strength", dark=True)
stat(d, x, 450, "0.58", "match with real climbers", "up from 0.46 untuned · 22 recorded climbs · experts 0.61", dark=True)
stat(d, x, 740, "89–100%", "chance to top on our walls", "up from 0–4%, after letting the climber stand up", dark=True)
c.save(f"{OUT}/t3-physics.png")

# 4. grade + 3D -----------------------------------------------------------------------------
c, d = base()
head(d, "Grade and 3D", "A grade for your body")
card(d, 110, 380, 800, 560)
d.text((160, 420), "GRADE · LIGHTGBM", font=LBL, fill=ACC)
d.text((160, 470), "24 features of your solved\nsequence + wall angle", font=BODY, fill=INK, spacing=10)
d.text((160, 600), "0.94 / 1.30", font=BIG, fill=ACC)
d.text((164, 750), "grade error, MoonBoard / Kilter", font=BODY, fill=INK)
d.text((164, 800), "guessing: 1.67 / 3.74 · range from 15th–85th %", font=SMALL, fill=MUTED)
card(d, 1010, 380, 800, 560)
d.text((1060, 420), "3D · DEPTH ANYTHING V2", font=LBL, fill=ACC)
d.text((1060, 470), "Depth from the one photo.\nSubtract a wide blur: only what\nsticks out remains. Each outlined\nhold is raised as a dome.", font=BODY, fill=INK, spacing=10)
d.text((1060, 750), "95%", font=BIG, fill=ACC)
d.text((1250, 800), "of holds raised", font=BODY, fill=INK)
c.save(f"{OUT}/t4-grade-3d.png")

# 5. coach + live camera ----------------------------------------------------------------------
c, d = base(dark=True)
head(d, "Voice coach + live camera", "It only says what\nthe physics worked out", dark=True)
card(d, 110, 480, 860, 440, dark=True)
d.text((160, 515), "ELEVENLABS CONVERSATIONAL AI · WEBRTC", font=LBL, fill=MINT)
for i, t in enumerate(("get_route()", "get_next_move()", "set_climber_height()")):
    d.rounded_rectangle([160, 575 + i * 90, 160 + 520, 575 + i * 90 + 70], 16, fill=(28, 50, 43))
    d.text((186, 584 + i * 90), t, font=CODE, fill=PAPER)
d.text((160, 850), "tools run in your browser · text-to-speech fallback", font=SMALL, fill=ON_INK)
stat(d, 1080, 460, "99.9%", "of frames: climber found", "MediaPipe Pose, in the browser", dark=True)
stat(d, 1080, 740, "350 ms", "on the hold = move done", "coach moves on by itself · no video leaves the phone", dark=True)
c.save(f"{OUT}/t5-coach.png")

# 6. accessibility + loop ---------------------------------------------------------------------
c, d = base()
head(d, "Accessibility + learning", "Climb without seeing\nthe colours")
stat(d, 110, 440, "1 in 12", "men is colourblind", "routes are marked by colour alone")
d.text((114, 720), "Colours are read from the pixels.\nThe coach says which hand and where,\nnever \"grab the red one\".", font=BODY, fill=INK, spacing=12)
card(d, 1010, 400, 800, 520)
d.text((1060, 440), "EVERY CLIMB MAKES IT BETTER", font=LBL, fill=ACC)
steps = ["climb", "followed by the camera", "saved, limb by limb", "physics retrained"]
for i, s in enumerate(steps):
    yy = 510 + i * 95
    d.ellipse([1060, yy, 1110, yy + 50], fill=ACC if i < 3 else MINT)
    d.text((1076, yy + 4), str(i + 1), font=LBL, fill=PAPER)
    d.text((1140, yy + 2), s, font=H2 if False else BODY, fill=INK)
d.text((1060, 880 - 20), "a new setting ships only if it wins on held-out routes", font=SMALL, fill=MUTED)
c.save(f"{OUT}/t6-access-loop.png")
print("ok")
