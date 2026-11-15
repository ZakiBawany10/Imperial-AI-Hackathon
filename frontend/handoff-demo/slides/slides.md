# Ascend slides

Made to `backend/demo/ascend-demo-video-SKILL.md`: 1920×1080, the app's colours and fonts only (ink
`#243e36`, paper, muted `#5a6e66`, hairline `#d2e2cb`, accent `#3f7a55` / `#7ca982`, route blue
`#2f6fde`; Barlow Condensed, Barlow, Barlow Semi Condensed, Josefin Sans for the wordmark), text inside
the 96 / 64 px safe area, and only numbers from the brief's table.

## Presenting

Open `deck.html` in Chrome (it needs the internet for the fonts). Move with ← and →, or space. F is full
screen. `deck.html?slide=N` shows slide N at 1920×1080; the PNGs below were rendered from that.

The demo video (`../videos/ascend-demo.mp4`) isn't a slide: play it on its own after slide 1.

## Order (as we present it)

| # | File | When | Exact text |
|---|---|---|---|
| 1 | `01-intro.png` | While we introduce ourselves | **Ascend** (wordmark) · "Point your phone at a wall. Get the climb." · "Krishna: hold finder, physics, 3D" · "Adam: the app" · "Zaki: voice coach". Right: two real app screens (route picked; beta with 3D climber, 5b / V1). |
| | *the demo video* | | `../videos/ascend-demo.mp4`, 59.5 s |
| 2 | `02-how-it-works.png` (S4) | After the demo | "How it works". Photo / your phone · Holds / 95% found · 87% right type · Route / colour grouping + your taps · Physics / balance and force on every limb · Coach / live camera + voice. Footer: "Physics checked against 22 recorded climbs by real climbers: picks the same hand holds 85% of the time." |
| 3 | `03-voice-coach.png` | What ElevenLabs does | Eyebrow "Voice coach · ElevenLabs" · "It talks you up the wall, one move at a time." · "An ElevenLabs voice agent reads the solved climb through three tools in your browser, so it only says what the physics worked out." · quote "Right hand, big move, up high to your right, the next jug up." · tools `get_route`, `get_next_move`, `set_climber_height`. Right: the Live screen with the voice coach speaking (Figma frame 4D). |
| 4 | `04-the-loop.png` (S5) | | "It gets better with every climb" · circle: climb → followed by the camera → saved → the app gets better · "Every climb you do retrains the physics." · "Voice coach + colour finding: you don't need to tell colours apart." |
| 5 | `05-design-before-after.png` | The design story | "Design: before and after" · "Before · BetaCrux" (first Figma Make prototype: upload screens, review screens) · "After · Ascend" (upload screens; beta and live screens). |
| 6 | `06-end.png` (S6) | Close and questions | **Ascend** (wordmark) · "ascend-climb.vercel.app" · "Krishna · Adam · Zaki: Imperial AI Hackathon" |

The quote on slide 3 is the coach's own example phrasing from `coach/prompt.md`. The tool names are from
`coach/tools.json`.

## For the 2-minute video cut

These are full-frame slides. They can also be used in Krishna's 2:00 cut:
- `02-how-it-works.png` as S4;
- `04-the-loop.png` as S5;
- `06-end.png` as S6.

S1, L1, S2 and S3 aren't made: this deck is for presenting live. The demo video has its own "Then it climbs it with you." card.

## Choices to check

- **Team roles** on the intro slide come from who owns what in the repo:
  - Krishna: `backend/`;
  - Adam: `frontend/`;
  - Zaki: `coach/`.

  Change them if you describe yourselves differently.
- **5b / V1** is the grade the app gives in the demo clip. No grade accuracy is claimed, as the brief asks.
