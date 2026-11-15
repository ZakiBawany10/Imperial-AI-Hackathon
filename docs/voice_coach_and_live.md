# Ascend: the voice coach, live climbing, and how it learns

How the ElevenLabs voice coach works, how it talks you up the wall while the
camera follows your climb, who it helps most, and how every climb makes the app
better. Use it for the pitch, the Q&A and the Devpost write-up.

---

## 1. The idea in one paragraph

You photograph a wall and pick a climb, and Ascend works out how *you* (your
height, your strength) should climb it, hands and feet. Then you prop the phone
up, get on the wall, and a voice coach talks you up it one move at a time, the
way a coach standing on the mat would: *"High left foot, then big move, right
hand to the next jug up, way out to your right."* The phone camera watches you
climb. When you land a move, the coach calls the next one without being asked.
When you're done, the climb is saved and the app learns from it.

---

## 2. The voice coach (ElevenLabs)

### What it is

An **ElevenLabs Conversational AI agent**: speech recognition, a language model
and ElevenLabs text-to-speech in one low-latency loop, connected from the
browser over **WebRTC** with the `@elevenlabs/client` SDK. You talk to it and it
talks back, hands-free, while you're on the wall.

### The key design decision: it can only say what the solver worked out

A language model left on its own will make up climbing advice. Ours can't,
because it doesn't know anything about the route except what it gets from
**three tools**. Those tools run **in the browser**, on the solved climb the app
already has:

| Tool | What it returns | When the coach uses it |
|---|---|---|
| `get_route` | Grade, number of moves, which move is the crux, every move in order | "What grade is this?" / "How long is it?" |
| `get_next_move` | The move to do now: which limb, how big a reach, where the hold is relative to your body, which hold, any foot moves first, whether it's the crux, plus 2–3 ready phrasings | "I'm ready", "Got it", "What's next?", or the camera saying a move is done |
| `set_climber_height` | Re-solves the climb for a new height and returns the new sequence | "I'm 5 foot 6", "What if I were taller?" |

The system prompt has one hard rule: **phrase it however you like, but never add
a hold, a direction, a body position or a distance the tool didn't give you.**
If you ask something the tools don't cover, it says it can't see that from
there.

Because the tools run in the browser, the backend stays stateless and the coach
answers instantly from data already on the phone.

### How it talks: like a coach, not a tape measure

All the hard work happens in `coach/coachTools.js`, which turns the solver's
geometry into how a climbing coach actually talks:

- **Reach is sized to you.** Hand travel as a share of your height is called a
  "short reach" (under 20%), "reach", "long reach", "big move" (60–85%) or
  "jump for it". The same move is a "reach" for a 1.90 m climber and a "big
  move" for a 1.55 m one.
- **Position is relative to your body**, worked out from your pose before the
  move: "just above your head", "out to your right at shoulder height", "by
  your left knee", "just above your right hand".
- **Holds are named the way people name them:** the type (jug, crimp, sloper,
  pinch, pocket, volume), plus "big", "small" or "little" when a hold stands
  out, and landmarks like "the jug your hands started on", "the next jug up",
  "the finish jug". A colour is mentioned only when it actually helps tell
  holds apart.
- **Feet are folded into the hand call** so the coach doesn't talk too much:
  "Left foot up by your knee, then long reach, right hand…". A foot on bare wall
  is called a **smear**.
- **The crux gets flagged before you reach it**, with one short tip chosen to
  fit the move: "This is the crux. Hips in." / "Commit to it."
- **Matches stay tiny:** "Match it."
- **Distances in metres** come only when you ask "how far?".
- **Short turns:** usually one sentence of under 15 words, because you're on
  the wall, out of breath, and can't look at a screen. It rotates its phrasings
  so it doesn't sound like a recording, and opens with a quick "Nice." or
  "Good." when you land a move.
- **Falls are handled kindly:** something brief and kind, then an offer to
  start again from the first move.

A real run on a demo route sounds like:

> "Match hands on the jug." → "High left foot, then big move, right hand to the
> next jug up, up high, way out to your right." → "Left foot up by your knee,
> then long reach, right hand to the next jug up." → "This is the crux. Commit
> to it. Left foot up by your knee, then big move, left hand to the finish jug,
> up high to your left." → "Match hands on the finish jug. Nice work, you've
> topped it."

### It never leaves you in silence

Three modes, with automatic fallback:

1. **Voice:** the full ElevenLabs conversation.
2. **Speech:** if voice can't connect (no signal, mic blocked) or drops
   mid-climb, the app switches to the phone's built-in speech, picks up from
   the move you were on, and reads the same coach sentences aloud.
3. **Text:** captions on screen, if there's no speech either.

The coach module has **36 automated tests** covering the phrasing, foot
merging, the progress nudge and the fallbacks.

---

## 3. Live mode: the camera follows you while the coach talks

This is the part that makes it a coach rather than a voice reading a list.

### Set-up

Prop the phone where you took the wall photo (on a tripod, or leaning on a
bag). The live view shows the photo faintly over the camera feed so you can line
them up. Every point in the video then matches the same point on the photo, and
so the same hold.

### Tracking

- **MediaPipe Pose** runs **on the phone, in the browser** (no video is
  uploaded). It finds your fingertips, wrists, toes and heels in every frame.
- A move counts as **done** when the right hand or foot arrives on the move's
  hold and **stays there for 0.35 s**. That ignores slaps and brushes.
- Seen from behind, left and right can get mixed up, so either hand counts for
  a hand move. A hand already on a hold doesn't count until it has left and
  come back, which is how matches work.
- On a real indoor clip filmed from behind, the tracker found the climber in
  **99.9% of frames** and recorded 30 limb-on-hold events in 30 seconds.

### Talking to you while you climb

The tracker feeds the coach's progress. When it sees you land a move:

1. The app sends the agent a message, *"Done. What's my next move?"*, as if you
   had said it.
2. The agent calls `get_next_move`, which reads the **tracker's** count, so it
   can't skip or repeat a move.
3. If the coach is still mid-sentence, the nudge waits for it to finish.
4. You hear "Nice." and then the next move, without saying a word or touching
   the phone.

You can still talk to it at any point: "say that again", "how far is that?",
"I fell, start again", "what grade is this?". Manual ‹ and Done › buttons are
there as a back-up.

### Recording the climb

While it watches, the app logs **every hand and foot landing on a route hold,
with a timestamp**, plus whether you topped out. When the camera stops, the
record goes to the backend (`POST /climbs`). The same tracker can also run over
a **filmed climb**, so a video from a session becomes a recorded climb too.

---

## 4. Built for colourblind and visually impaired climbers

Gym routes are colour-coded, and so are the holds that tell you which climb is
which. That is a real barrier for the roughly **1 in 12 men and 1 in 200
women** who are colourblind, and for climbers with low vision.

- **The app sees the colours for you.** It groups every route on the wall by
  colour and lights up the one you chose, so you never have to tell red from
  brown or blue from purple.
- **The coach tells you which hold to grab, out loud, as you climb.** You get
  the limb, the direction relative to your own body ("just above your head",
  "by your left knee"), and what the hold feels like ("small crimp", "big
  jug"). Clear directions, not colours.
- **The feedback is live.** The camera knows when you've landed a move, and the
  coach calls the next one straight away. You don't need to look down at a
  screen, read a route card or ask a partner.
- **It's a conversation.** Ask "where's the next hold?", "say that again" or
  "how far?" at any point, hands-free.
- **It works without perfect signal:** if the voice connection drops, the phone
  keeps reading the moves aloud.

For a visually impaired climber, that's the difference between needing someone
on the mat shouting beta and climbing on their own.

---

## 5. It learns from every climb

Every climb the camera follows is used in two ways.

### a. Retrieval (RAG): "on a route like this before…"

Each recorded climb is stored with its route: hold positions, hold types, how
high and far apart they are, the climber's height and strength, and what they
actually did. When you open a new climb, the app searches the stored climbs for
**the most similar routes** (`POST /climbs/similar`) and brings back what people
did on them. That's shown as **"Climbs like this"** on the Play screen and
**"On a route like this before…"** next to the coach in Live mode. The
knowledge grows with every climb, and nothing needs retraining for it to work.

### b. Training: confirmed climbs make the physics better

The physics engine decides which sequence you're shown: which holds, which
order, which hand, where your feet go, how likely you are to fall. It was
first tuned on **22 recorded climbs by real climbers** (The Way Up dataset).
Tuning raised its agreement with what people actually did from **0.46 to
0.58**, close to human experts at **0.61**. It now picks the same hand holds as
real climbers **85%** of the time, up from 70%.

Every climb Ascend records is saved in **exactly the same format** as those
22. So each confirmed climb becomes new training data, and the engine is
retuned on the original climbs plus every climb our users have done.

The safety rule: **a new version ships only if it beats the current one on
held-out climbs, on both a random split and on routes it has never seen.** It
can only get better, never quietly worse.

The loop: **climb → camera tracks it → saved → similar routes find it → physics
retrains on it → the next climber gets better beta.** The more people climb
with Ascend, the more it knows.

---

## 6. Under the hood (for technical questions)

| Piece | What we used |
|---|---|
| Voice agent | ElevenLabs Conversational AI, WebRTC via `@elevenlabs/client`; 3 client tools; agent created and updated from code (`coach/setup_agent.mjs`) |
| Move-to-speech logic | `coach/coachTools.js`, plain JavaScript with no dependencies |
| Live tracking | MediaPipe Pose Landmarker (lite), in the browser |
| Fallback voice | The browser's built-in speech synthesis |
| Climb store, retrieval, retraining | FastAPI backend: `POST /climbs`, `POST /climbs/similar`, `train_physics.py` |
| Physics baseline data | The Way Up: 22 recorded climbs, 11 climbers |
| App | React, Vite, Tailwind, three.js 3D viewer |
| Hosting | Frontend on Vercel, backend on a laptop GPU through a Cloudflare tunnel |

**Privacy:** pose tracking runs on the phone, and no video leaves the device.
Only the list of limb-on-hold events is saved. Stored climbs are kept out of
the public repo.

---

## 7. Demo script for this part (about 60 seconds)

1. "Now I'm on the wall." Play the climb, with the phone camera view and the
   predicted 3D climb side by side.
2. Let the coach call two or three moves as the tracker ticks them off. Point
   out that nobody pressed anything.
3. On the crux, let the judges hear "This is the crux. Commit to it."
4. One line on accessibility: "If you can't tell the colours apart, you never
   have to. The app finds the route and the coach tells you where to go."
5. One line on learning: "That climb is now saved. The next person on a route
   like this gets what we learned from it, and the physics retrains on it."
