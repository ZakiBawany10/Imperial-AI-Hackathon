# Usage: python align.py <workdir> <wall-photo.jpeg>
# Align the wall photo (app space 1536x2048) to every frame of the climbing video.
# 1) median background (removes the climber), 2) SIFT photo->background homography,
# 3) per-frame background->frame homography from SIFT on the wall only (to follow any
#    camera shake), smoothed. Writes H.npy (N,3,3: photo px -> video px) and debug images.
import cv2, numpy as np, json, sys
D = sys.argv[1]            # work dir holding climb.mp4; outputs land here
PHOTO = sys.argv[2]        # the wall photo the app analysed
cap = cv2.VideoCapture(f"{D}/climb.mp4")
frames = []
while True:
    ok, f = cap.read()
    if not ok: break
    frames.append(f)
N = len(frames); h, w = frames[0].shape[:2]
print("frames", N, w, h)
bg = np.median(np.stack(frames[::6]), axis=0).astype(np.uint8)
cv2.imwrite(f"{D}/bg.jpg", bg)

photo = cv2.imread(PHOTO)
print("photo raw", photo.shape)
photo = cv2.resize(photo, (1536, 2048), interpolation=cv2.INTER_AREA)
sift = cv2.SIFT_create(6000)
g = lambda im: cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
kp1, d1 = sift.detectAndCompute(g(photo), None)
kp2, d2 = sift.detectAndCompute(g(bg), None)
bf = cv2.BFMatcher()
def match(da, db, ka, kb, ratio=0.75):
    m = bf.knnMatch(da, db, k=2)
    good = [a for a, b in m if a.distance < ratio * b.distance]
    pa = np.float32([ka[x.queryIdx].pt for x in good]); pb = np.float32([kb[x.trainIdx].pt for x in good])
    return pa, pb
pa, pb = match(d1, d2, kp1, kp2)
H0, inl = cv2.findHomography(pa, pb, cv2.RANSAC, 4.0)
print("photo->bg matches", len(pa), "inliers", int(inl.sum()))
warp = cv2.warpPerspective(photo, H0, (w, h))
cv2.imwrite(f"{D}/check_overlay.jpg", cv2.addWeighted(bg, 0.5, warp, 0.5, 0))

# per-frame camera motion relative to the background, using ORB on a downscale (fast)
orb = cv2.ORB_create(3000)
s = 0.5
kb, db = orb.detectAndCompute(g(cv2.resize(bg, None, fx=s, fy=s)), None)
bfh = cv2.BFMatcher(cv2.NORM_HAMMING)
Hs = []
for i, f in enumerate(frames):
    kf, df = orb.detectAndCompute(g(cv2.resize(f, None, fx=s, fy=s)), None)
    m = bfh.knnMatch(db, df, k=2)
    good = [a for a, b in (x for x in m if len(x) == 2) if a.distance < 0.75 * b.distance]
    if len(good) < 30:
        Hs.append(np.eye(3)); continue
    A = np.float32([kb[x.queryIdx].pt for x in good]) / s; B = np.float32([kf[x.trainIdx].pt for x in good]) / s
    Hf, inl = cv2.findHomography(A, B, cv2.RANSAC, 3.0)
    Hs.append(Hf if Hf is not None else np.eye(3))
Hs = np.array(Hs)
# smooth the per-frame motion (moving average over 7 frames)
k = 3
Hsm = np.array([Hs[max(0, i - k):i + k + 1].mean(axis=0) for i in range(N)])
shift = [np.linalg.norm((Hsm[i] @ np.array([w / 2, h / 2, 1]))[:2] / (Hsm[i] @ np.array([w / 2, h / 2, 1]))[2] - [w / 2, h / 2]) for i in range(N)]
print("camera drift px: max %.1f median %.1f" % (max(shift), float(np.median(shift))))
Hfull = np.array([Hsm[i] @ H0 for i in range(N)])
np.save(f"{D}/H.npy", Hfull)
