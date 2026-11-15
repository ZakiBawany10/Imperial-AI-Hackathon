# Ascend: pitch script

The script for `docs/slides/ascend-pitch.pptx`, which has 16 slides. Six are the original slides from
`frontend/handoff-demo/slides/` and ten are new, built in the same theme from `ascend-writeup.md`. The
demo video plays between slides 2 and 3. The same words are in each slide's speaker notes.

**Length.** About 10 minutes spoken, plus the 60-second video. For a 5-minute slot, skip the slides
marked *(optional)*: 5, 6, 10, 12, 13 and 15.

**Numbers.** Every number is from the slides or the writeup. Two things to know:
- Slide 3 says the physics picks the same hand holds as real climbers **85%** of the time. Slide 11
  says the sequence match is **0.58**. These are two different measures, so don't treat them as one.
- The writeup's "experts 0.XX" is still a placeholder, so it is left off slide 11. Don't quote it.

---

## 1. Intro (`01-intro`) · Zaki · ~30 s

Hands up if you've ever stood at the bottom of a climbing wall, stared at it, and had no idea how
to start. That's most climbers, most sessions. Ascend fixes that.
Point your phone at a wall, and you get the climb: the holds, the route, the moves for *your* body,
and a coach that talks you up it.

We're three people. **Krishna** built the hold finder, the physics and the 3D. **Adam** built the
app. And I'm **Zaki**, I built the voice coach.

## 2. The problem (new) · Zaki · ~45 s

So why build it? Four reasons.

**One: new gym, new grades.** You climb V4 at home, then on holiday or after a move you walk into a
gym that grades by tape colour, or Font, or whatever the setter felt like that week. The regulars
know the beta. You don't.

**Two: a grade is one setter's opinion,** set with an average-height climber in mind. Meanwhile
boards like the MoonBoard and Kilter have tens of thousands of climbs that real people have graded
and repeated, and none of that has ever reached a normal gym wall.

**Three: routes are colours.** If you're colourblind, red and green holds can look the same. With
low vision it's harder still: black holds on a dark wall, tiny footholds, chalk, shadow. Visually
impaired climbers compete, but they usually rely on a sighted guide calling from the ground.

**Four: "we both climb 6b"** doesn't mean much when one of you is 1.60 m and the other is 1.90 m.

So: point your phone at any wall and get the beta, how hard it is *for your body*, and a coach that
talks you up it. Then record the climb and share it. Here it is.

## Demo video (`ascend-demo.mp4`) · 60 s

Play it with no talking over it. When it ends:

**Zaki:** That's the experience. Krishna, how does it work?

## 3. How it works (`02-how-it-works`) · Krishna · ~60 s

Five steps.
1. **Photo.** One picture from your phone.
2. **Holds.** Our trained hold finder picks out 95% of the holds and gets the type right 87% of the
   time: jug, crimp, sloper, pinch, pocket or volume.
3. **Route.** In a gym a colour *is* a route, so we group holds by colour. You tap the route, then
   its start and top holds. The app only asks about the two holds it's least sure of and fills in
   the rest.
4. **Physics.** For every move we work out balance and the force on every limb, hands *and* feet,
   for your height and your strength. That picks the sequence, and gives each move an effort, your
   chance of falling, and your overall chance of topping out.
5. **Coach.** A live camera and a voice take you up it. The same photo also becomes a 3D wall with
   a jointed climber doing the moves.

We checked the physics against 22 climbs recorded by real climbers. It picks the same hand holds
they did 85% of the time.

## 4. A grade for your body (new) · Krishna · ~45 s

A normal grade assumes one average climber. Ours doesn't. Your height changes how far apart every
hold is for you, and your strength changes how hard each hold is to hang on to.

Our solver's reach is set for a 1.75 m climber. Rather than shrink the climber, we rescale the wall:
every distance is multiplied by 1.75 over your height. A shorter climber gets a "bigger" wall where
every span is longer. Strength scales every grip limit. The grade is worked out from the sequence
you would actually climb, so it's personal without needing a separate model.

That makes comparing with friends fair. For example, a reach-heavy route might be a 6c for someone
at 1.60 m and a 6b for their friend at 1.90 m. Now the app can show that, and show you which moves
made the difference.

## 5. Under the hood (new, optional) · Krishna · ~45 s

The whole flow. The phone sends one photo to `/analyze`, which returns the holds and the colour
routes. You pick a route and set your height and strength. `/solve` returns the moves, the poses,
the physics and the grade. Separately, `/depth` turns the photo into a relief map for the 3D wall.

- **Seeing the wall:** a YOLO11s detector fine-tuned on ClimbInst gym photos finds the holds, a
  YOLO11n classifier labels the type, and a YOLO11s-seg model outlines each hold. Depth Anything V2
  gives depth: we subtract a wide blur so only what sticks out of the wall is left, and each outlined
  hold becomes a dome.
- **Physics and grade:** non-negative least squares for balance, and LightGBM trained on Kilter and
  MoonBoard climbs for the grade, all behind a Python and FastAPI backend that keeps no state.
- **The app (Adam):** React 19, Vite, TypeScript and Tailwind, mobile-first and installable as a
  PWA. It started as a Figma Make prototype. MediaPipe Pose runs on your phone.
- **Voice and hosting:** ElevenLabs for the coach, with browser speech as a fallback. The models
  need 3 to 4 GB in memory, so the backend runs on a laptop GPU behind a Cloudflare Tunnel, and the
  frontend is on Vercel. One script, `go_live.sh`, sets all of it up.

## 6. Safest, not shortest (new, optional) · Krishna · ~50 s

Two ideas.

**The solver picks the safest route, not the shortest.** Each move costs minus log of one minus its
chance of falling. Add those up and the cheapest path is exactly the sequence with the highest
chance of reaching the top. Feet are then planned for each hand position, onto route holds or
smearing on bare wall.

**The physics.** Every body position has to balance: forces and turning forces add up to zero.
Each hand or foot can only push or pull the way its hold allows. A jug works almost any way, a
crimp mostly downwards, a sloper only straight down. That turns into one small least-squares
problem, about 50 microseconds per position. A hand's grip limit is hold quality times your
strength, and a move's effort is how much of that limit it uses. At 1 or more, you can't hold it.

One bug we're proud of fixing: early on, the climber squatted under low holds and first moves were
basically impossible. Letting it stand up with feet on the floor took the chance of topping out on
our demo walls from 0–4% to 89–100%.

## 7. Voice coach (`03-voice-coach`) · Zaki · ~50 s

Reading beta off a screen while you're hanging off a wall doesn't work. So the coach talks to you,
one move at a time.

It's an ElevenLabs voice agent, and the important bit is that it doesn't make anything up. It reads
the solved climb through three tools running in your browser: `get_route` for the whole climb,
`get_next_move` for where you are now, and `set_climber_height`, which re-solves for your body
when you tell it your height. Everything it says comes from the physics. It sounds like this:
*"Right hand, big move, up high to your right, the next jug up."* If the voice agent drops out, the
browser reads the moves aloud instead.

## 8. Accessibility (new) · Zaki · ~50 s

We didn't set out to build an accessibility app, but a lot of what we built matters most for
climbers who struggle to see the route.

- **Colourblind climbers:** every route is named by a colour read from the photo, not from your
  eyes. Pick it by name and its holds are marked on your photo. If two similar colours get merged,
  you can split them or tap a hold to fix it.
- **Hard-to-see holds:** dark holds on dark walls, holds in shadow, chalked holds, tiny footholds.
  The detector finds them whether or not they stand out to the eye, and the 3D view lets you turn
  the wall and see what sticks out. Very small holds, under about 20 pixels, are still our weak
  spot.
- **Low-vision and blind climbers: live video.** This is the part we're most excited about. You
  film yourself, and MediaPipe Pose tracks your hands and feet in the browser. The coach tells you
  which hand or foot moves next and what kind of hold it's going to. When a fingertip or toe
  reaches the hold and stays there, the coach moves on by itself. You never need to look at the
  screen or touch the phone. It works a bit like a sight guide on the ground, without needing a
  second person.

## 9. The loop (`04-the-loop`) · Zaki · ~25 s

And it gets better with every climb. You climb, the camera follows you, the climb is saved, and it
retrains the physics. Because the coach *says* the holds and we find the colours for you, you
don't need to tell colours apart.

## 10. Record and share (new, optional) · Adam · ~40 s

When you climb in live mode, Ascend records it. Along with the video, it saves every time a hand or
foot lands on a hold, with a timestamp. Upload it and your friends can:
- watch your climb next to the planned sequence and see where your beta was different;
- see your personal grade next to theirs on the same route;
- find it under "Climbs like this" on similar routes.

The tracking happens on your phone, so the video only gets uploaded if you choose to share it.
Every shared climb is also real data from a real gym wall, which is exactly what our grade model is
missing. The more people share, the better the grades get.

## 11. Results (new) · Krishna · ~50 s

Everything here is on held-out data.
- **Holds:** 95% found on 50 test photos with 3,433 holds, against 38% for an off-the-shelf
  zero-shot detector. On 19 photos from real gyms, 87%.
- **Hold type:** right with its top guess 87% of the time, and in its top three 98%, against 42%.
- **Physics against real climbers:** a sequence match of 0.58, up from 0.46 before tuning.
- **Routes:** 43% come out as one clean colour group, against 19%.
- **Grade error,** in Font grade steps: 0.94 on MoonBoard and 1.30 on Kilter, against 1.67 and 3.74
  for guessing the median.
- **Live tracker:** it finds the climber in 99.9% of frames.

The grade numbers are on the training boards, not on gym walls. That's next.

## 12. What we ran into (new, optional) · Krishna, then Adam · ~60 s

- **Small holds.** Zero-shot found 38%. Fine-tuning got us to 95%, and cutting the photo into tiles
  helped with tiny footholds. Under 20 pixels is still the weak spot.
- **Colour is harder than it looks.** Shadows make blue, purple, red and black blur together, and
  one wall had four different green routes. Even a threshold tuned per tap only got about 52%
  right. So we stopped chasing perfect grouping and designed around it: colour chips you merge or
  split, and you can tap any hold to fix it. That ended up helping colourblind climbers too.
- **Too many questions.** The hold-type model is usually right but rarely confident. Small holds
  always came back as "foot" at about 50%, and some routes asked eight questions. We capped it at the
  two least confident holds per route, so checking takes a few seconds.
- **The squatting climber.** Standing up off the floor took topping out from 0–4% to 89–100%.
- **A data leak.** The hold-type dataset had augmented copies of the same photo in both train and
  test, which inflated our accuracy. We re-split by original photo, so every number is on genuinely
  unseen data.
- **Grading real gym walls.** The grade model does well on the boards but is no better than guessing
  on a real gym wall. We say that up front, and lead with what's personal and reliable: effort per
  move and your chance of reaching the top.

## 13. What we learned (new, optional) · Zaki · ~40 s

1. **Design around the model's weak spots.** Our biggest improvements came from product decisions:
   colour chips instead of perfect grouping, two questions instead of eight.
2. **Physics generalises where data doesn't.** A balance model with a handful of tuned settings
   transferred to real gym walls far better than a grade model trained on 75,000 board climbs.
3. **Put the caveat next to every number.** Overlapping walls, augmented copies and board-only
   results all made things look better than they were until we checked.
4. **Ship the whole thing early.** Running the full loop at a real gym showed us problems no
   benchmark did.
5. **Accessibility features help everyone.** Spoken moves and hands-free tracking were built for
   visually impaired climbers, and they're the most useful parts for anyone who doesn't want to keep
   looking down at their phone.

## 14. Design before and after (`05-design-before-after`) · Adam · ~40 s

On the left is our first prototype, BetaCrux, made in Figma Make. It worked, but it asked you to do
a lot: confirm every hold, say what kind of hold each one is, and read a wall of text.

On the right is Ascend. Clear steps along the top (photo, route, you, beta), the app does the
finding, and it only asks what it can't work out. The beta screen is a player you step through move
by move, and live mode is one screen: camera, next move, and the coach.

## 15. What's next (new, optional) · Zaki · ~35 s

- **First, testing with colourblind and visually impaired climbers,** and building around what they
  tell us.
- **Richer spoken directions,** like where the next hold is from your hand: "up and right, about
  half a metre."
- **Grades that work on real gym walls,** trained on climbs recorded through the app.
- **Learning your gym,** by retraining the hold-type model on the holds you confirm.
- **Dynos, momentum and proper sit starts.**
- **Friend groups and leaderboards per gym,** ranked by personal grade so height and strength don't
  decide who's top.

## 16. End (`06-end`) · Zaki · ~15 s, then questions

That's Ascend. Point your phone at a wall, get the climb, get talked up it. Try it now at
**ascend-climb.vercel.app**. We're Krishna, Adam and Zaki. Thank you, and we'd love your questions.

---

## Likely questions

- **How accurate is the grade?** On the boards, under one Font grade on MoonBoard (0.94). On real gym
  walls it's no better than guessing yet, so we lead with effort per move and chance of topping out,
  and show a range rather than one grade.
- **Where does the grade range come from?** Extra models at the 15th and 85th percentiles.
- **Why voice?** Your hands are busy and you can't look at a phone mid-move.
- **Can the coach make up beta?** No. It only reads what the solver returned, through three client
  tools.
- **Privacy?** Pose tracking runs on the phone. Video is only uploaded if you choose to share it.
- **Does it work outdoors?** It's built and tested on face-on gym walls.
- **Why a laptop GPU?** The models need 3 to 4 GB kept in memory. It's behind a Cloudflare Tunnel.
