# contract/

Owner: Krishna

The API contract is in "The one shared thing: the API contract" in
[PLAN.md](../Documents/PLAN.md). This folder holds fixed examples of it, all
produced by the real backend from one photo. Build against these when the
server is not running.

| File | What it is |
|---|---|
| `wall.jpg` | The photo (1920 × 1440) |
| `analyze.json` | `POST /analyze` response for `wall.jpg`: 178 holds, 69 of them with `needs_review: true` |
| `hold_types.json` | `GET /hold-types` response |
| `solve_request.json` | A `POST /solve` body: the yellow route on the left wall, 7 holds, after the user has confirmed each hold's type |
| `solve.json` | The response to that body: 4 moves, 5 keyframes, grade 6a+ |

## Points the plan leaves open, and what the backend does

These are readings of the contract, not changes to it.

- **Hold position.** `x`, `y` are the centre of the hold. `w`, `h` are the full
  width and height of its box. All in pixels of the photo.
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

Nobody changes the contract without telling the other two first.
