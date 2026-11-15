# contract/

Owner: Krishna

The API contract is in "The one shared thing: the API contract" in
[PLAN.md](../Documents/PLAN.md). This folder holds fixed examples of it, all
produced by the real backend from one photo. Build against these when the
server is not running.

| File | What it is |
|---|---|
| `wall.jpg` | The photo (1920 × 1440) |
| `analyze.json` | `POST /analyze` response for `wall.jpg`: 178 holds grouped into 32 routes (trained models) |
| `hold_types.json` | `GET /hold-types` response |
| `solve_request.json` | A `POST /solve` body: the yellow route on the left wall, 7 holds, after the user has confirmed each hold's type |
| `solve.json` | The response to that body: 11 moves (hands and feet), 12 keyframes, physics, grade 6a+ |

## Points the plan leaves open, and what the backend does

These are readings of the contract, not changes to it.

- **Hold position.** `x`, `y` are the centre of the hold. `w`, `h` are the full
  width and height of its box. All in pixels of the photo.
- **Colours and routes** (`/analyze`, from `backend/routes.py`). Gyms colour-code
  climbs, so the backend groups holds by colour and position:
  - top level `routes: [{"id", "color", "color_name", "holds": [hold ids]}]`,
    biggest first; `id` is the index in the list;
  - per hold `route`: index into `routes`, or `null` for a hold that groups with
    no other;
  - per hold `color_name`: a plain word (`"yellow"`, `"grey"`, ...);
  - per hold `color`: the refined colour from `routes.py` (read from the hold's
    own pixels, not the box), as `#rrggbb`.
  Tapping a hold can select `routes[hold.route].holds`. The grouping is not
  perfect (on 8 labelled photos it gets a whole route in one group about half
  the time; on `wall.jpg` the yellow climb is split over routes 11 and 3), so let
  the user add or remove holds.
- **Photo orientation.** `/analyze` turns a phone photo upright using its EXIF
  tag before measuring, the same way a browser `<img>` shows it. `image.w` and
  `image.h` are the upright size.
- **Keyframes.** `keyframes[k].move` is the number of moves done so far.
  `keyframes[0]` (`move: 0`) is the start pose and `keyframes[k]` is the pose
  after `moves[k-1]`. There is always one more keyframe than there are moves.
- **Drawing the figure.** Both arms start at the neck and both legs at the hip.
  The neck is not sent: it is on the line from `head` to `hip`, 27.5% of the
  way down from `head`. Draw `head`–`hip`, neck–`l_elbow`–`lh`,
  neck–`r_elbow`–`rh`, `hip`–`l_knee`–`lf`, `hip`–`r_knee`–`rf`.
- **Moves are hands only** for now, so `limb` is `LH` or `RH`. Two hands can be
  on the same hold; a move onto the hold the other hand is on is a match.
- **`load`** runs from 0 to 1. It is the solver's cost for that move, scaled;
  use it to colour moves, not as a physical force.
- **Hold type pictures** are SVG: `image` is a path on the API server, such as
  `/hold-types/jug.svg`.
- **Type guesses.** `suggestions` are the type classifier's top three, and
  `needs_review` is true when its top guess is below 0.6. The classifier has
  no foot class, so very small holds are guessed as `foot` at 0.5 and always
  need review. `unknown` is never guessed; it is there for the user to pick.
- **Errors.** A failed call returns `{"detail": "message"}`. `/solve` answers
  422 with a message meant for the user when: no sequence exists, a start or
  finish id is not in the hold list, more than two start holds are marked (one
  per hand), a hold is both start and finish, or a field is missing or out of
  range. `/analyze` answers 400 when the file is not an image.
- **Defaults for `/solve`.** `climber_height_m` 1.75, `wall_height_m` 4.0,
  `wall_angle_deg` 0. Extra fields on a hold (`score`, `suggestions`, …) are
  accepted and ignored, so the frontend can send holds back unchanged.

## Added by the physics engine (15 November)

All optional, all live on `/solve` now; older readers can ignore them.

- **Request:** `strength` (0.6 to 1.5, default 1.0 = a regular gym climber). `climber_height_m`
  is now strictly 1.40 to 2.10 m; outside that `/solve` answers 422.
- **Moves:** `limb` can be `LF` or `RF` (a foot move). `hold` is `null` for a foot on the bare
  wall. Each move also has `effort` (share of grip strength the hardest-working hand needs;
  1.0 or more cannot be held), `stable` (true/false) and `fall_chance` (0 to 1).
- **Keyframes:** `contacts` `{"LH", "RH", "LF", "RF"}` = the hold id each hand and foot is on
  (null = bare wall or floor), and `physics` = `{"com": [x, y], "effort", "stable",
  "forces": [{"limb", "at": [x, y], "f": [fx, fy], "share"}]}` (pixels; f in body-weights).
- **Top level:** `physics` = `{"model", "max_effort", "mean_effort", "unstable_positions",
  "finish_chance", "sequence": "safest"}`. The moves shown are the sequence least likely to
  end in a fall; the grade still comes from the hand-only search.
- **Climb rules:** the climber starts standing on the floor with hands on the start hold(s),
  never touches the floor again, and finishes with both hands on the top hold.
- **`POST /depth`** (form field `file`): a greyscale PNG relief map of the wall photo,
  black = flat wall, white = sticks out most. The 3D viewer uses it as `reliefUrl`.

Nobody changes the contract without telling the other two first.
