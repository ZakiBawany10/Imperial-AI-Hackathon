# Ascend demo video: handoff to Krishna

From Adam, 15 November. Everything needed to watch the demo video, re-make it, and keep developing it.
It lives in `frontend/` because CLAUDE.md lets Adam's agent write only there. Move it to the repo
root if you like (your call, it is your rules file too).

**Start with:** `videos/ascend-demo.mp4` (59.5 s, 1080×1920, 30 fps, with sound).

## What the video shows

| Time | Part | File |
|---|---|---|
| 0–5.6 s | Adam's real iPhone screen recording at the gym: taking the photo, uploading it, "Finding holds" starting. On the hosted site it then hung on "Finding holds" (see Known issues), so the recording is cut here. | `videos/clips/01-real-start.mp4` |
| 5.6–44 s | The rest of the flow, recorded automatically on the same wall photo with the current frontend: find holds → pick **Blue** → start holds → top → 4 hold questions → You → Solve (5b / V1, 8 moves) → 3D beta playing. A 0.4 s dissolve joins it to the real recording. | `videos/clips/02-app-flow.mp4` |
| 44–46 s | Title card "Then it climbs it with you." | (made in Concat) |
| 46–59.5 s | **Ghost climber:** the solved beta drawn as a glowing figure over the real climb of the blue route, timed to the real climber's moves. | `videos/clips/03-ghost-climb.mp4` |
| | The 3D Play screen on its own (14.5 s) | `videos/clips/04-3d-beta.mp4` |
| | The ghost alone on a transparent background (VP9 WebM with alpha), to lay over the footage in another editor. The full-quality ProRes 4444 version (`03b-ghost-overlay.mov`, 110 MB) is over GitHub's 100 MB file limit, so it isn't in git: ask Adam for it (on his Mac in `~/Movies/Ascend demo/clips/`), or re-make it with `pipeline/render.py`. | `videos/clips/03b-ghost-overlay.webm` |

All phone clips are 884×1920 screens centred on a 1080×1920 frame with ink `#243E36` side bands.

## Folder map

```
handoff-demo/
  README.md            this file
  videos/              the finished video and its parts
  sources/             the gym footage the video was made from
    wall-photo-IMG_9528.jpeg   the wall photo (4284×5712, EXIF upright)
    climb-IMG_9529.mp4         the climb of the blue route (1080×1920, 29.97 fps, 16.6 s)
    screen-recording-raw.MP4   Adam's full iPhone screen recording from the gym (884×1920, 120 fps, 30 s), uncut
  pipeline/            the scripts that made it (see "Re-make it")
    record.mjs                 drives the app in headless Chrome and records it at iPhone size
    align.py                   lines the photo up with every video frame (homographies)
    timing.py                  finds when the real climber reaches each hold (YOLO pose)
    render.py                  draws the ghost and composites it
    phone-statusbar.png        iOS status bar cut from the real recording (884×131)
    phone-safari-toolbar.png   Safari toolbar cut from the real recording (884×295)
  data/                what the pipeline produced, so nothing has to be re-run to inspect it
    analyze.json               /analyze for the photo as the app sent it (1536×2048, 50 holds, 9 routes)
    solve_request.json         the /solve body the app sent (blue route, start [38, 34], finish [4])
    solve.json                 the /solve answer (8 moves, 9 keyframes, physics)
    timing.json                video frame where each solved move lands (fps 29.97)
    marks_rel.json             when each step happens in the raw app recording (seconds)
```

In the raw screen recording, the camera runs from 0 to 3 s and the photo uploads at about 4 s. The app then sits on "Finding holds" until about 26 s. The demo uses 0–5.6 s.

## How it was made

1. **App recording (`record.mjs`).**
   - **Setup:** puppeteer-core 23 drives the real frontend (`localhost:5173`, backend `:8010`).
   - **Size:** the viewport is 390×659 CSS px at device scale 884/390. 659 is the height between the iOS status bar and the Safari toolbar in Adam's recording.
   - **Capture:** frames come straight from DevTools (`Page.startScreencast`). Chrome must be launched with `--force-device-scale-factor=2.2667`, or headless screencast frames come out at CSS size (390 px wide).
   - **Taps:** a soft ring shows each tap. Buttons are clicked through the DOM; holds are tapped with the touchscreen API.
   - **Output:** it writes `frames/`, `frames.json` (timestamps), `marks.json`, `analyze.json`, `solve_request.json` and `solve.json`.
   - **Turning frames into video:** ffmpeg's concat demuxer uses the frame timestamps, normalised to 30 fps. Then pad to 884×1920 with the status bar on top (y 0–131) and the toolbar at the bottom (y 1625–1920).
2. **Alignment (`align.py`).**
   - **Background:** the median of every 6th video frame gives a clean wall with no climber.
   - **Photo to video:** SIFT matching and a RANSAC homography map the photo (scaled to 1536×2048, the app's space) onto that background.
   - **Camera shake:** per-frame ORB homographies follow the camera (drift was 8–13 px), smoothed over 7 frames. Output: `H.npy`, one 3×3 per frame (photo px to video px).
3. **Timing (`timing.py`).**
   - **Pose:** `yolo11n-pose.pt` (ultralytics, auto-downloads) gives the climber's wrists and ankles in every frame.
   - **When a move lands:** a solved move counts as landed when a matching limb stays within reach of its hold (mapped through `H`) for 3 frames.
   - **Result:** the first foot goes on at 2.17 s and both hands match on the top hold at 10.4 s.
4. **Ghost (`render.py`).**
   - **Pose between keyframes:** the solve's keyframe joints are eased between the move times. Moves that landed together are spread into their own slots.
   - **Drawing:** the figure uses the contract's neck rule (27.5% from `head` to `hip`). Its size comes from `wall_height_m`, so it is life-size.
   - **Look:** a translucent mint core with a soft glow, and glows on the holds in use. It fades in 1.6 s before the first move and fades out 1.4 s after the last.
   - **Optional third argument:** `lead_seconds` makes the ghost arrive early, so it reads as "the plan" rather than a copy.
5. **Edit.** The parts were laid out in Concat (open-source editor, MCP-scriptable): clips, the dissolve, titles, export. You can edit in anything; the clips are standalone.

## Re-make it

You need:
- ffmpeg, and Google Chrome at `/Applications/Google Chrome.app`;
- `npm i puppeteer-core@23` in a scratch folder (not the repo);
- a Python with `opencv-python` ≥ 4.4 (SIFT), `numpy` and `ultralytics`. The backend venv has all three.

```sh
# backend :8010 and frontend :5173 running first
node pipeline/record.mjs sources/wall-photo-IMG_9528.jpeg /tmp/rec
mkdir -p /tmp/ghost && cp sources/climb-IMG_9529.mp4 /tmp/ghost/climb.mp4
python pipeline/align.py  /tmp/ghost sources/wall-photo-IMG_9528.jpeg
python pipeline/timing.py /tmp/ghost /tmp/rec
python pipeline/render.py /tmp/ghost /tmp/rec          # add 0.5 for a ghost half a second ahead
```

`record.mjs` is written for this wall. Before using another photo, change these in it:
- the climb colour it picks (`"blue"`);
- the start hold ids (`38`, then `34` as the second start).

## Things to know

- **Hold ids depend on the image size.** The frontend shrinks photos to 1536×2048 before `/analyze`, so ids from a full-resolution `/analyze` are different holds. The first attempt picked "hold 39" from a full-size run, which in the app is a red **route-number sticker** ("7"). Use the ids from `data/analyze.json`.
- **The detector finds route tags.** The round number stickers gyms put by start holds come back as holds (one became hold 39 above). The backend could filter small round red/maroon discs, or the type classifier could get a "tag" class.
- **The gym's two "1" tags mark the blue start:** holds 38 and 34 in the app's numbering.
- **One hold answer is odd.** The 4 type questions were answered with the app's best guess, so one blue hold went in as a foot chip.
- **The ghost uses the defaults,** a 1.75 m climber at strength 1.0, so its body won't exactly match the real climber's.

## Known issues to look at

1. **The hosted site hung on "Finding holds"** during the gym test (`ascend-climb.vercel.app`, 09:35 on 15 Nov). The frontend sat there for 20+ seconds with no error. The local backend analyses the same photo in a few seconds, so the likely causes are:
   - the tunnel or backend on your laptop was down or asleep;
   - the request hung, and the frontend has no timeout on `/analyze`.

   A timeout with a clear error in `src/lib/api.ts` would be worth adding (Adam's side).
2. **The 3D camera starts too far out** on phones. See `../FOR_KRISHNA.md` for the `frame: "climb"` viewer option Adam asked for.
3. **The hosted frontend is behind `main`.** Re-run `backend/go_live.sh` to publish the newer frontend (scan animation, art, route grouping fix).

## Other context

- `../HANDOFF.md`: the frontend's state, stack, testing method and file map.
- `../FOR_KRISHNA.md`: open requests from Adam for the viewer.
- `../../CLAUDE.md`: repo rules (who writes where).
- `../../contract/README.md`: the API contract (routes, physics fields, keyframes).
- `../../backend/README.md`: running the backend, `/depth`, going live.
