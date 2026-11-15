"""Voice mode in the demo: Zaki's questions and the ElevenLabs coach, laid over the 3D section and the
followed climb, with subtitles. The climb pauses where a line needs room.

usage: python voice_cut.py EDIT_DIR AUDIO_DIR FONTS_DIR [landscape]
  EDIT_DIR has climb_l.mp4 / climb_p.mp4 (track_video.py at --slow 0.6) and 3d_l.mp4 / 3d_p.mp4
  AUDIO_DIR has zaki.m4a and coach.mp3
Writes app_v_{l,p}.mp4 and climb_v_{l,p}.mp4 with sound.
"""
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

E, A, FONTS = sys.argv[1:4]
LAND = sys.argv[4:5] == ["landscape"]
O = "l" if LAND else "p"
W, H = (1920, 1080) if LAND else (1080, 1920)
FPS, SR = 30, 48000
INK, PAPER, MINT = (36, 62, 54), (255, 255, 255), (150, 235, 190)
F = lambda n, s: ImageFont.truetype(os.path.join(FONTS, n), s)
TXT, TAG = F("Barlow-SemiBold.ttf", 40 if LAND else 44), F("BarlowSemiCondensed-SemiBold.ttf", 30)

# the lines: (who, file, start s, end s, subtitle)
LINES = {   # coach: ElevenLabs take of 15 Nov 11:34 (crux = blue foot chip); zaki: his phone recording
    "hello": ("COACH", "coach", 0.00, 3.62, "Hi, I'm your Ascend coach. Tell me when you're on the start holds."),
    "grade?": ("ZAKI", "zaki", 0.00, 1.40, "What grade is this?"),
    "grade": ("COACH", "coach", 3.85, 8.20, "It's about a V2. The crux is a high step onto the blue foot chip."),
    "on": ("ZAKI", "zaki", 1.60, 2.80, "I'm on the start holds."),
    "first": ("COACH", "coach", 8.40, 13.05, "Great. First move, right hand up to the small blue crimp, head height."),
    "crux": ("COACH", "coach", 13.15, 18.15, "This is the crux. Left foot high onto the yellow volume. Knee to your chest."),
    "feet?": ("ZAKI", "zaki", 4.45, 6.85, "How much pressure in my feet and left hand?"),
    "feet": ("COACH", "coach", 18.45, 22.70, "Mostly feet, about 70%. Left hand's light, just balance."),
    "top": ("COACH", "coach", 22.90, 25.40, "That's the top. Brilliant climbing."),
}


def load(name):
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", os.path.join(A, name), "-ac", "1", "-ar", str(SR),
                                   "-f", "f32le", "-"])
    return np.frombuffer(raw, np.float32)


AUD = {"zaki": load("zaki.m4a"), "coach": load("coach.mp3")}
# Zaki's phone recording is quieter than the coach: bring them level
for k in AUD:
    AUD[k] = AUD[k] / (np.percentile(np.abs(AUD[k]), 99.5) + 1e-6) * 0.7


def frames_of(path):
    cap = cv2.VideoCapture(path)
    out = []
    while True:
        ok, f = cap.read()
        if not ok:
            return out
        out.append(f)


def subtitle(img, who, text, a):
    d = ImageDraw.Draw(img, "RGBA")
    maxw = 900 if (LEFT and LAND) else (1240 if LAND else 960)
    words, lines, cur = text.split(), [], ""
    for w in words:
        nxt = (cur + " " + w).strip()
        if d.textlength(nxt, font=TXT) <= maxw - 80 or not cur:
            cur = nxt
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    tw = max(d.textlength(l, font=TXT) for l in lines)
    bw, bh = tw + 80, 64 + 52 * len(lines)
    if LEFT and LAND:                # beside the phone, under the step caption
        x0, y0 = 150, 640
    else:
        x0 = (W - bw) / 2
        y0 = H - bh - (40 if LAND else 120)
    al = int(235 * a)
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], 28, fill=INK + (al,))
    d.text((x0 + 40, y0 + 16), who, font=TAG, fill=(MINT if who == "COACH" else PAPER) + (int(255 * a),))
    for i, l in enumerate(lines):
        d.text((x0 + 40, y0 + 52 + 52 * i), l, font=TXT, fill=PAPER + (int(255 * a),))


LEFT = False


def render(frames, cues, out, left=False):
    global LEFT
    LEFT = left
    """frames: list of BGR frames (the picture); cues: [(line key, start s)]."""
    n = len(frames)
    audio = np.zeros(int(n / FPS * SR) + SR, np.float32)
    subs = []
    for key, t in cues:
        who, src, a, b, text = LINES[key]
        clip = AUD[src][int(a * SR):int(b * SR)].copy()
        fade = int(0.03 * SR)
        clip[:fade] *= np.linspace(0, 1, fade)
        clip[-fade:] *= np.linspace(1, 0, fade)
        s = int(t * SR)
        audio[s:s + len(clip)] += clip[:max(0, len(audio) - s)]
        subs.append((t, t + (b - a) + 0.25, who, text))
    wav = out + ".f32"
    np.clip(audio[:int(n / FPS * SR)], -1, 1).astype(np.float32).tofile(wav)
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                          "-r", str(FPS), "-i", "-", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", wav,
                          "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-c:a", "aac", "-b:a", "192k",
                          "-ar", str(SR), "-ac", "2", "-shortest", "-movflags", "+faststart", out], stdin=subprocess.PIPE)
    for i, f in enumerate(frames):
        t = i / FPS
        img = Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
        for t0, t1, who, text in subs:
            if t0 - 0.1 <= t <= t1:
                a = min(1.0, (t - t0 + 0.1) / 0.15, (t1 - t) / 0.15)
                subtitle(img, who, text, max(0.0, a))
        p.stdin.write(np.asarray(img).tobytes())
    p.stdin.close()
    p.wait()
    os.remove(wav)


def dur(key):
    return LINES[key][3] - LINES[key][2]


def main():
    # ---- the climb: built from climb_*.mp4 (0.6x: 1 source second = 50 frames), pausing for the talk
    src = frames_of(os.path.join(E, f"climb_{O}.mp4"))
    at = lambda s: min(len(src) - 1, int(round(s * 50)))
    out, cues = [], []

    def play(a, b):
        out.extend(src[at(a):at(b)])

    def hold(s, secs):
        out.extend([src[at(s)]] * int(round(secs * FPS)))

    now = lambda: len(out) / FPS
    def say(key, gap=0.25):
        """Cue a line now and hold the frame until it is said."""
        cues.append((key, now()))
        hold(1.3, dur(key) + gap)

    play(0.0, 1.3)                                   # Zaki walks up to the wall
    for key in ("hello", "grade?", "grade", "on"):   # the talk before he climbs
        say(key)
    cues.append(("first", now()))                    # "Great. First move ..."
    hold(1.3, 1.6)
    play(1.3, 4.0)                                   # moves 1-4
    cues.append(("crux", max(now(), cues[-1][1] + dur("first") + 0.25)))   # move 5: the crux call
    play(4.0, 8.71)                                  # moves 5-6
    t_end_crux = cues[-1][1] + dur("crux")
    play(8.71, 9.6)
    if now() < t_end_crux + 0.2:
        hold(9.6, t_end_crux + 0.2 - now())
    cues.append(("feet?", now()))                    # before the last hand move
    cues.append(("feet", now() + dur("feet?") + 0.3))
    hold(9.6, dur("feet?") + 0.3 + dur("feet") - 0.6)
    play(9.6, 10.85)                                 # both hands on the top
    cues.append(("top", now()))
    play(10.85, 12.3)
    if now() < cues[-1][1] + dur("top") + 0.4:
        hold(12.3, cues[-1][1] + dur("top") + 0.4 - now())
    fade = 9
    for i in range(fade):
        k = (fade - i) / fade
        out[-fade + i] = (out[-fade + i].astype(np.float32) * k + np.float32(INK[::-1]) * (1 - k)).astype(np.uint8)
    render(out, cues, os.path.join(E, f"climb_v_{O}.mp4"))
    print(O, "climb", round(len(out) / FPS, 1), "s;", [(k, round(t, 1)) for k, t in cues])


if __name__ == "__main__":
    main()
