# Devpost draft: BetaCrux

Draws only on the root `README.md` and `docs/numbers.md`. Items marked **TODO**
need filling in or confirming before submission.

**Tagline:** Photograph a climbing wall. Get the moves, a grade, and a voice
coach that talks you up it.

## Inspiration

Every climbing gym grades its own routes, and every climber has stood under a
problem wondering how to start it, and whether "blue V3" here means the same as
V3 down the road. Grades are one setter's opinion, and they're set for an
average-height climber. Boards like the MoonBoard and Kilter Board have tens of
thousands of graded climbs, but that data has never been usable on an ordinary
gym wall. We wanted to point a phone at any wall and get the beta, a grade, and
a coach.

## What it does

- **Finds every hold** in a photo of a gym wall: position, size, colour and type
  (jug, crimp, sloper, pinch, pocket, volume, foot).
- **Picks out the route** when you tap one hold, since gym routes are
  colour-coded. You mark the start and finish.
- **Asks only about the holds it's unsure of**, with a close-up and its top
  three guesses, so checking takes a few taps.
- **Solves the climb** for your height: the cheapest sequence of hand moves.
  Drag the height slider and the sequence changes, because it's a solver, not a
  lookup.
- **Animates a stick figure** climbing the route over your photo, marks the crux
  move, and gives a grade with a likely range.
- **Coaches you by voice** while you climb, calling one move at a time the way a
  coach on the mat would: "High left foot, then big move, right hand to the
  next jug up, up high, way out to your right."

## How we built it

- **Hold detection:** a YOLO11s detector we fine-tuned on ClimbInst gym photos,
  with Grounding DINO as a zero-shot fallback. A YOLO11n classifier, fine-tuned
  on real gym photos, labels each hold's type.
- **Solver:** a shortest-path search over left-hand and right-hand positions.
  Each move costs more the further the hand travels, the worse the holds, and
  the closer the span is to full reach. Reach scales with the climber's height.
- **Grade model:** LightGBM on 24 numbers from the solved sequence, plus wall
  angle. It was trained on 54,362 Kilter Board climbs and 20,710 MoonBoard 2016
  problems. It never sees which board a climb came from, so it can be given a
  gym route.
- **API:** FastAPI, stateless. The frontend sends the whole route with each call,
  and every position is a pixel in your photo, so the app draws straight onto it.
- **Voice coach:** an ElevenLabs agent whose three tools (get the route, get the
  next move, change height) run in the browser on the route the app already
  has. It folds foot moves into the next hand move so it doesn't talk too much
  on the wall.
- **Adaption:** we turned every MoonBoard problem into a short plain-English
  description ("7 hand holds… up 0.8 m left 0.4 m to a 5…") paired with its
  grade, to fine-tune a language model with Adaption. The descriptions use
  metres and hold difficulty rather than board coordinates, so the same function
  can describe a gym route. The test rows are identical to the grade model's,
  so the two can be compared directly. **TODO:** run the fine-tune and report
  its result, or reword this as "prepared".
- **Design:** Figma. **TODO:** confirm with Adam and add a screenshot.

## Challenges we ran into

- **Finding holds.** A zero-shot detector found only 38% of holds on held-out
  photos. Fine-tuning a detector on labelled gym photos took that to 95%.
- **Teaching the solver about reach.** Without a penalty for near-full-reach
  moves, the solver skipped holds and made 1.5 m moves. Adding one fixed the
  sequences and also cut grade error on both boards.
- **Knowing how good a hold is from a photo.** On the MoonBoard, removing hold
  quality loses about half of the solver's gain over guessing (error rises from
  0.94 to 1.28 grade steps), which is why the app asks you to confirm unsure
  holds.
- **Honest evaluation.** Our hold-type dataset stores each photo as several
  augmented copies, some in more than one of its splits, so we re-split by
  original photo. Every number is on held-out data.
- **Data licences and privacy.** The MoonBoard scrape includes setters' names
  and cities, which we drop. The detector's training data is non-commercial.

## Accomplishments that we're proud of

- Photo to holds to sequence to animation to grade, end to end, in a weekend.
- **Grade error of 0.94 Font grade steps** on held-out MoonBoard problems, from
  solver features alone, against 1.67 for always guessing the median grade.
  **1.30 steps** on held-out Kilter climbs, against 3.74.
- **95% of holds found** on held-out photos, against 38% zero-shot.
- **Hold type right 87% of the time, and in the top three 98%**, against 43%
  for always guessing the most common type.
- Change the climber's height and the beta changes.

## What we learned

- Two boards are better than one: adding MoonBoard problems to the Kilter
  training data kept Kilter error about the same (1.30 → 1.31 grade steps) and
  cut MoonBoard error from 1.84 to 0.94.
- A small amount of user input, a few taps on unsure holds, buys a lot of
  accuracy.
- Measure on held-out data, and say what the data is: our grade numbers are on
  climbing boards, not gym walls yet.

## What's next for BetaCrux

- **Score on real gym routes:** compare our grade with the gym's own grade on
  routes we photographed. **TODO:** if this is measured before submission, it's
  the headline number.
- **Foot moves:** four-limb sequences, then a force-balance check per position.
- **Live mode:** a fixed phone camera tracks the climber's wrists in the
  browser, matches them to holds, and the coach follows along in real time.
- **Learn from corrections:** every hold type a user confirms is a new labelled
  training example.

## Built with

**TODO:** Devpost tags. Suggested: python, fastapi, pytorch, yolo, ultralytics,
grounding-dino, hugging-face, lightgbm, scikit-learn, elevenlabs, adaption,
figma, javascript.

## Try it out

**TODO:** GitHub repo link, and a demo video link.
