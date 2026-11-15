# Render the solved climber as a glowing ghost over the real climb.
# Inputs: climb.mp4, H.npy (photo->video per frame), timing.json, solve.json/solve_request.json.
# Outputs: ghost_comp.mp4 (ghost over footage, with the original audio) and ghost_alpha.mov
# (ProRes 4444 with alpha, the ghost alone). Usage: render.py <ghostdir> <recdir> [lead_seconds]
import cv2, numpy as np, json, sys, subprocess
D, REC = sys.argv[1], sys.argv[2]
LEAD = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0   # ghost reaches each hold this much earlier
H = np.load(f"{D}/H.npy")
T = json.load(open(f"{D}/timing.json")); fps = T["fps"]
solve = json.load(open(f"{REC}/solve.json")); req = json.load(open(f"{REC}/solve_request.json"))
KF = solve["keyframes"]; NM = len(solve["moves"])
cap = cv2.VideoCapture(f"{D}/climb.mp4"); N = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
W, Hh = int(cap.get(3)), int(cap.get(4))

# ---- when each keyframe is reached (frame numbers), from the real climber's moves ----
ends = [f if f is not None else None for f in T["move_frames"]]
for i in range(NM):                     # fill gaps evenly
    if ends[i] is None:
        prev = ends[i - 1] if i else 50
        nxt = next((ends[j] for j in range(i + 1, NM) if ends[j] is not None), prev + 30 * (NM - i))
        ends[i] = prev + (nxt - prev) / 2
ends = [float(e) - LEAD * fps for e in ends]
gap = 0.4 * fps                          # moves that landed together get their own slots
for i in range(1, NM):
    if ends[i] - ends[i - 1] < gap:
        before = ends[i - 2] if i >= 2 else ends[0] - 1.2 * fps
        ends[i - 1] = (before + ends[i]) / 2
starts = []
for i in range(NM):
    before = ends[i - 1] if i else ends[0] - 1.0 * fps
    starts.append(max(before, ends[i] - 0.75 * fps))
t_in, t_out = ends[0] - 1.6 * fps, ends[-1] + 1.4 * fps   # fade the ghost in and out

ease = lambda t: t * t * (3 - 2 * t)
names = ["head", "hip", "lh", "rh", "l_elbow", "r_elbow", "lf", "rf", "l_knee", "r_knee"]
def pose_at(fi):
    if fi <= starts[0]: return KF[0]["joints"], KF[0]["contacts"]
    for i in range(NM):
        if fi < starts[i]: return KF[i]["joints"], KF[i]["contacts"]
        if fi <= ends[i]:
            p = ease((fi - starts[i]) / max(1e-6, ends[i] - starts[i]))
            a, b = KF[i]["joints"], KF[i + 1]["joints"]
            return {n: [a[n][0] + (b[n][0] - a[n][0]) * p, a[n][1] + (b[n][1] - a[n][1]) * p] for n in names}, KF[i + 1]["contacts"]
    return KF[-1]["joints"], KF[-1]["contacts"]

def to_v(pt, fi):
    p = H[fi] @ np.array([pt[0], pt[1], 1.0]); return (p[0] / p[2], p[1] / p[2])
px_per_m = req["image"]["h"] / req["wall_height_m"]
vscale = np.hypot(*np.subtract(to_v((0, 0), 0), to_v((100, 0), 0))) / 100
M = px_per_m * vscale        # video px per metre
holds = {h["id"]: h for h in req["holds"]}

GLOW = (170, 235, 190)   # BGR sage-mint
CORE = (245, 255, 248)
SS = 2                   # supersample for smooth strokes
def draw(fi):
    j, contacts = pose_at(fi)
    P = {n: to_v(j[n], fi) for n in names}
    head, hip = np.array(P["head"]), np.array(P["hip"])
    neck = head + (hip - head) * 0.275
    P["neck"] = tuple(neck)
    bones = [("neck", "hip"), ("neck", "l_elbow"), ("l_elbow", "lh"), ("neck", "r_elbow"), ("r_elbow", "rh"),
             ("hip", "l_knee"), ("l_knee", "lf"), ("hip", "r_knee"), ("r_knee", "rf")]
    core = np.zeros((Hh * SS, W * SS), np.float32); glow = np.zeros_like(core)
    q = lambda pt: (int(pt[0] * SS), int(pt[1] * SS))
    limb = max(4, 0.09 * M); headr = 0.11 * M
    for a, b in bones:
        w = limb * (1.45 if (a, b) == ("neck", "hip") else 1.0)
        cv2.line(core, q(P[a]), q(P[b]), 1.0, int(w * SS), cv2.LINE_AA)
    cv2.circle(core, q(head), int(headr * SS), 1.0, -1, cv2.LINE_AA)
    # holds in use glow softly
    for limbk, hid in contacts.items():
        if hid is None or hid not in holds: continue
        h = holds[hid]; c = to_v((h["x"], h["y"]), fi)
        cv2.circle(glow, q(c), int(0.07 * M * SS), 1.0, -1, cv2.LINE_AA)
    core = cv2.resize(core, (W, Hh), interpolation=cv2.INTER_AREA)
    glow = cv2.resize(glow, (W, Hh), interpolation=cv2.INTER_AREA)
    halo = cv2.GaussianBlur(core, (0, 0), 0.06 * M) * 1.4 + cv2.GaussianBlur(glow, (0, 0), 0.05 * M) * 1.6
    # alpha: translucent body, brighter rim of glow
    fade = np.clip(min((fi - t_in) / (0.5 * fps), (t_out - fi) / (0.6 * fps)), 0, 1)
    a_core = core * 0.62
    a_halo = np.clip(halo, 0, 1) * 0.7
    alpha = np.clip(a_core + a_halo * (1 - a_core), 0, 1) * fade
    col = np.zeros((Hh, W, 3), np.float32)
    wc = np.clip(core / np.maximum(core + halo, 1e-6), 0, 1)[..., None]
    col[:] = np.array(GLOW, np.float32)
    col = col * (1 - wc) + np.array(CORE, np.float32) * wc
    return col, alpha

comp = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{Hh}", "-r", f"{fps}",
                         "-i", "-", "-i", f"{D}/climb.mp4", "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-crf", "17",
                         "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", f"{D}/ghost_comp.mp4"], stdin=subprocess.PIPE)
alph = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", f"{W}x{Hh}", "-r", f"{fps}",
                         "-i", "-", "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", f"{D}/ghost_alpha.mov"], stdin=subprocess.PIPE)
fi = 0
while True:
    ok, f = cap.read()
    if not ok: break
    if t_in - 2 <= fi <= t_out + 2:
        col, a = draw(fi)
    else:
        col, a = np.zeros((Hh, W, 3), np.float32), np.zeros((Hh, W), np.float32)
    out = f.astype(np.float32) * (1 - a[..., None]) + col * a[..., None]
    comp.stdin.write(np.clip(out, 0, 255).astype(np.uint8).tobytes())
    bgra = np.dstack([col, a * 255]).clip(0, 255).astype(np.uint8)
    alph.stdin.write(bgra.tobytes())
    if fi in (int(ends[0]), int(ends[2]), int(ends[4]), int(ends[-1])):
        cv2.imwrite(f"{D}/still_{fi}.jpg", np.clip(out, 0, 255).astype(np.uint8))
    fi += 1
comp.stdin.close(); alph.stdin.close(); comp.wait(); alph.wait()
print("ends (s):", [round(e / fps, 2) for e in ends], "fade", round(t_in / fps, 2), round(t_out / fps, 2), "M px/m", round(M, 1))
