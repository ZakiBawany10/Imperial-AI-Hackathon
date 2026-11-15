---
name: ascend-demo-video
description: Make the slides and title cards for Ascend's 2-minute demo video so they drop straight into Krishna's edit. Use when building any slide, title card, caption or end card for the Ascend demo or pitch.
---

# Ascend demo video: slides that fit the cut

The demo is **one 2:00 video**, landscape **1920×1080, 30 fps**. It is built from three kinds of part:

| Part | Who | What |
|---|---|---|
| App footage | Adam (done: `frontend/handoff-demo/videos/clips/`) | Phone screen recordings |
| Gym footage | Krishna | Zaki climbing, followed by the camera, with the app's plan beside it |
| Zaki talking | Zaki | Speaking to camera |
| **Slides and cards** | **Adam (this skill)** | Title cards, three short explainer slides, end card |

Krishna does the final edit. Your job is the slides: exact size, exact timing, the app's look, and
only numbers we can stand behind.

## The cut (2:00)

| Time | Length | On screen | Sound | Slide needed |
|---|---|---|---|---|
| 0:00 | 6 s | Zaki on the wall, real footage. Title card fades in over it. | music in | **S1 Title** (transparent) |
| 0:06 | 14 s | Zaki to camera: the problem. You walk up to a wall and don't know how to climb it, you climb alone, you can't tell the route colours apart. | Zaki | lower third **L1** |
| 0:20 | 30 s | App flow: photo → holds found → tap **Blue** → start and top → Solve → grade. From `02-app-flow.mp4`, sped up 1.3× to 1.5× where it waits. Phone framed in the middle. | Zaki voice-over, music low | **S2 side captions** (transparent, left and right of the phone) |
| 0:50 | 15 s | 3D beta playing (`04-3d-beta.mp4`): the climber, balance point, effort, chance to finish. | voice-over | **S2 side captions** continue |
| 1:05 | 3 s | Card: "Then it climbs it with you." | | **S3 Card** (full frame) |
| 1:08 | 22 s | Zaki climbing the blue route. The camera follows him and ticks off the app's moves, and the voice coach calls the next move. Adam's ghost cut can be the second half. | coach voice + Zaki | none |
| 1:30 | 12 s | How it works: one slide | voice-over | **S4 How it works** |
| 1:42 | 10 s | Gets better with every climb + accessibility | voice-over | **S5 The loop** |
| 1:52 | 8 s | End card: name, link, team | music out | **S6 End card** |

All times are targets, ±1 s each. **Don't change the order.** If something has to be shorter,
say which and by how much. Don't cut it yourself.

## Size, format and files

- **Full-frame slides (S3, S4, S5, S6):** 1920×1080 **PNG**, with a solid background.
- **Overlays (S1, S2, L1):** 1920×1080 **PNG with transparency**. Anything outside the text is
  fully transparent.
- **Animation:** optional. Export each animated slide as a 1920×1080 ProRes 4444 `.mov` (alpha)
  or an `.mp4` (no alpha), at the slide's exact length from the cut table. Keep motion calm: one
  fade or slide-in per element, 300–500 ms, ease-out. No bounces, spins or zoom-punches.
- **Safe area:** keep all text 96 px from the left and right edges and 64 px from the top and
  bottom.
- **The phone clips are 1080×1920.** In the landscape cut, the phone is scaled to **1000 px high
  and centred** (about 563 px wide). That leaves about 620 px on each side for S2 captions:
  - left column x 96–640;
  - right column x 1280–1824.
- **Where they go:** `frontend/handoff-demo/slides/`, named `S1-title.png`, `S2a-photo.png`, and
  so on, plus `slides.md` listing each file, its start time, its length and its exact text.

## Look (the app's own)

Use the frontend's tokens (`frontend/src/index.css`). Don't add new colours.

| Use | Token |
|---|---|
| Background | `#ffffff` paper; full-frame slides may use ink `#243e36` with paper text |
| Text | ink `#243e36`, muted `#5a6e66` |
| Lines and dividers | hairline `#d2e2cb` |
| Accent (one thing per slide) | `#3f7a55` accent-ink, or `#7ca982` on dark |
| Route-colour tape (only when naming a route colour) | blue `#2f6fde`, yellow `#e8b100`, green `#2e8b57` |
| Warnings (rare) | alert `#b5452f` |

**Fonts:**
- **Headlines:** Barlow Condensed 700, sentence case, 96–140 px on full slides, 56–72 px on
  overlays.
- **Body:** Barlow 500, 36–44 px. **Numbers:** Barlow Semi Condensed 600, tabular.
- **Josefin Sans:** only for the wordmark "Ascend", as in the app.

**Layout rules:**
- One idea per slide. At most 3 lines of body text.
- Generous white space; left-aligned unless a slide is a single centred line.
- No stock photos, emoji, gradients, drop shadows or clip-art icons. Use real screenshots from
  the app or footage.
- At most 8 words on any overlay over moving footage.

**Text style:** plain, short and concrete. Say what it does, not what it "leverages".
- No "revolutionary", "seamless", "AI-powered", "unlock" or "empower".
- Every number must come from the list below.

## What each slide says

**S1 Title (overlay on Zaki climbing, bottom-left):**
> **Ascend**
> Point your phone at a wall. Get the climb.

**L1 Lower third (while Zaki talks):**
> Zaki · climber, Ascend team

**S2 Side captions (one at a time, synced to the app flow; left column, ≤ 6 words each):**
1. "Take one photo of the wall"
2. "It finds every hold" (sub-line: "95% of holds, in 0.2 s")
3. "Tap the colour you're climbing"
4. "Pick the start and the top"
5. "It works out the moves"
6. "And grades the climb" (show the grade the app shows in the clip, e.g. "5b / V1")
7. (3D part) "Your body, your height, your strength"
8. (3D part) "Where you'll struggle, and your chance to top it"

**S3 Card (full frame, ink background, centred):**
> Then it climbs it with you.

**S4 How it works (full frame, paper). Five boxes in a row, left to right, joined by thin arrows:**

| Step | Line under it |
|---|---|
| Photo | your phone |
| Holds | 95% found · 87% right type |
| Route | colour grouping + your taps |
| Physics | balance and force on every limb |
| Coach | live camera + voice |

Footer, small and muted: "Physics checked against 22 recorded climbs by real climbers: picks
the same hand holds 85% of the time."

**S5 The loop (full frame, paper).** A simple circle of four steps:
> climb → followed by the camera → saved → the app gets better

Under it, two short lines:
> Every climb you do retrains the physics.
> Voice coach + colour finding: you don't need to tell colours apart.

**S6 End card (full frame, ink):**
> **Ascend** (wordmark)
> ascend-climb.vercel.app
> Krishna · Adam · Zaki: Imperial AI Hackathon

## Numbers we can use (and how to say them)

| Say | Source / caveat |
|---|---|
| "Finds 95% of holds" | ClimbInst test photos. On our own gym photos it's 87%; say "about 9 in 10" if in doubt |
| "Right hold type 87% of the time" | top guess; 98% in the top 3 |
| "In 0.2 seconds" | the hold finder per photo |
| "Picks the same hand holds as real climbers 85% of the time" | The Way Up, 22 climbs |
| "Followed the climber in 99.9% of frames" | live camera tracker test clip |

**Don't put on a slide:**
- Any grade accuracy. It's fine on training boards, but on real gym walls it's no better than
  guessing, so just show the grade the app gives.
- Route grouping accuracy (about half).
- Any user or market numbers. We have none.

## Zaki talking (for Zaki, so the slides match)

- **Camera:** landscape, eye level, phone on something steady. Shoot at the gym with the wall
  behind him, in a quiet moment.
- **Length:** 14 s for the problem at 0:06. The voice-overs (0:20–1:05 and 1:30–1:52) can be
  recorded separately, phone close, on a quiet take.
- **Script (his words are fine, keep the points):**
  1. "When you walk up to a wall, you don't know how to climb it, and there's often no one to ask."
  2. "Ascend: one photo, it finds the holds, works out the moves for your body, and grades it."
  3. "Then it coaches you live while you climb, out loud."
  4. "And it gets better with every climb anyone records."

## Before you hand over

- [ ] Every file is 1920×1080; overlays are transparent outside the text.
- [ ] Text is inside the safe area, and S2 captions sit in the side columns, not over the phone.
- [ ] Only the app's colours and fonts are used.
- [ ] Every number appears in the table above, worded the same way.
- [ ] `slides.md` lists the file, start time, length and exact text for each slide.
- [ ] Pushed to `frontend/handoff-demo/slides/` (Adam's folder). Tell Krishna it's in.
