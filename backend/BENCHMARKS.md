# Benchmarks

Every accuracy number the project has. Written by `benchmarks.py` from the `results_*.json` files; do not edit by hand, run `.venv/bin/python benchmarks.py` again.

Words: a *hold* is a grip bolted to the wall. A *route* is the set of holds one climb uses, usually all one colour. The *grade* says how hard a climb is (4a easiest here, 6a, 6a+, 6b ... harder; each is one step). A *training board* (Kilter, MoonBoard) is a standard wall with a fixed grid of holds that thousands of people climb and grade through an app.

## Finding holds

| What is measured | Result | Compared against | Rests on | Caveat |
|---|---|---|---|---|
| Holds found in photos of walls the hold finder has never seen (the finder the app uses) | 95% | 38% for an off-the-shelf finder with no training; 91% for ours without cutting the photo into tiles | 50 photos, 3,433 holds | Test photos are from the same public dataset (ClimbInst) as the training photos; whether they show the same walls has not been checked. |
| Of the things it marks as holds, the share that really are holds (same photos) | 86% | 87% off-the-shelf; 90% ours without tiles | 50 photos, 3,433 holds | A person on the wall is marked as holds; photograph the wall empty. |
| Time to find the holds in one photo | 0.21 s | 5.3 s off-the-shelf | 50 photos, 3,433 holds | On an M5 laptop. |
| Holds found in 19 hand-labelled photos of two real gyms | 87% | not compared (the off-the-shelf finder was not run on these) | 19 photos, 1,688 holds | Not an independent test: 18 of 19 photos show a wall, with the same holds, that is also in a training photo taken from another spot (0 are training photos themselves). Read as: new camera angles of walls it already knows. |
| Of the things it marks as holds, the share that really are holds (same 19 photos) | 95% |  | 1,549 marked | Measurable because every hold in these photos is labelled. Same overlap with training. |
| Small or far-away holds found (under 20 pixels across in a 1,920-pixel photo), same 19 photos | 46% | 96% for holds over 40 pixels across (997 holds) | 242 holds | This is where the misses are. Stand close enough that holds are not tiny. |
| The same, leaving out any photo that is itself a training or validation photo | 87% found, 95% of marks real |  | 18 photos, 1,612 holds | 1 of the 19 is a validation photo (used to choose which training checkpoint to keep). |
| The same, only photos whose wall is in no training photo (the clean ones) | 97% found, 100% of marks real |  | 1 photo(s), 34 holds | Only 5% of the 19 photos are clean, and in a gym the finder has seen. Too few to be a score. |

## Hold type

| What is measured | Result | Compared against | Rests on | Caveat |
|---|---|---|---|---|
| Hold type (big easy grip, thin edge, ...): the top guess is right | 87% | 42% by always guessing the most common type | 2,737 holds | Gym photos with no copy in training. From one public dataset, not our own gym. |
| The right type is among the top three guesses (what the user picks from) | 98% |  | 2,737 holds |  |
| Holds the app is confident about, so it does not ask the user to check | 92% of holds; 91% of those are right |  | 2,737 holds | The rest are flagged for the user to confirm. |
| Top guess right, by type, weakest first | rounded, no edge 77%; squeeze grip 80%; big easy grip 84%; thin edge 92%; finger hole 97%; big shape 98% |  | 2,737 holds | There is no "foot only" type in the training data; the app guesses it from size and always flags it. |

## Seeing routes

| What is measured | Result | Compared against | Rests on | Caveat |
|---|---|---|---|---|
| Routes the app sees as one group, well enough that one click selects the route (holds known as boxes) | 43% | 19% for the old rule (holds of a similar colour) | 68 routes in 8 photos | Small test. A route counts when the selected group matches it well (F1 of 0.8 or more). The holds given are the hand-labelled ones, not the hold finder's output. Settings were chosen on seven photos and scored on the eighth, in turn. |
| Holds where a click selects that hold's own route | 40% | 8% old rule | 587 holds in 8 photos | Stricter: every hold counts once. |
| Of the holds in a selected group, the share that belong to the route / of the route's holds, the share selected | 84% / 73% | 62% / 80% old rule | 68 routes in 8 photos | Averaged over routes, best-matching group for each. |
| Routes seen as one group when each hold's exact outline is known, not only its box | 52% | 19% old rule | 68 routes in 8 photos | Uses hand-drawn outlines; the app's own outlines are rougher. |
| Routes seen as one group when the boxes are moved at random by up to 15%, to imitate the hold finder | 40% | 21% old rule | 68 routes in 8 photos | Settings as shipped, chosen with these photos in view, so slightly flattering. |

## How hard (grade)

| What is measured | Result | Compared against | Rests on | Caveat |
|---|---|---|---|---|
| How far off the app's grade is on average, Kilter board, in grade steps (6a to 6a+ is one step) | 1.31 steps | 3.74 steps by always guessing the middle grade | 10,664 test rows | On a training board (a standard wall with a fixed grid of holds, graded by thousands of users), not on gym walls. Climbs held out from training. |
| Grade within one step of the true grade, Kilter board | 64% | 20% always guessing the middle grade | 10,664 test rows | Exactly right: 24%. |
| The same on easier climbs only (below 6b), Kilter board | 1.39 steps; 62% within one step |  | 3,847 test rows | Most gym climbers are in this range; the error is about the same. |
| How far off the app's grade is on average, MoonBoard, in grade steps | 0.94 steps | 1.67 steps by always guessing the middle grade | 4,142 test climbs | On a training board (a standard wall with a fixed grid of holds, graded by thousands of users), not on gym walls. This board only has hard climbs (6b+ and up). |
| Grade within one step of the true grade, MoonBoard | 79% | 67% always guessing the middle grade | 4,142 test climbs | Exactly right: 38%. |
| Does working out the moves help? Grade error from the solved move sequence, Kilter board | 1.30 steps | 1.55 from the list of holds alone; 1.85 from distances alone, ignoring how good each hold is | 10,664 test rows | On a training board (a standard wall with a fixed grid of holds, graded by thousands of users), not on gym walls. |
| The same on MoonBoard | 0.94 steps | 0.88 from the list of holds alone; 1.28 when the solver is not told how good each hold is | 4,142 test climbs | Here the plain list of holds does slightly better: this board never changes, so a model can memorise its holds. That does not carry over to a gym wall; the move sequence does. |
| How far off the grade is on real gym routes | not measured yet |  | 0 routes | No gym route with a known grade has been scored. The numbers above are for training boards. |

## Is the gym-photo test independent?

Not an independent test. 0 of the 19 photos are among the 300 training photos, and 1 is among the 60 validation photos (used to pick which training checkpoint to keep). But 18 of 19 show a wall, with the same holds on it, that is also in a training photo taken from another spot: the training set contains this photographer's photos of the same two gyms (205 of its 300 photos). Only 1 of 19 shows holds the detector has not seen, and it is in a gym it has seen; that is too few to be a score. Read these numbers as: new camera angles of walls the detector already knows.
Every hold and volume in the 19 photos is outlined, down to chips a few pixels wide (checked by eye with the labels and predictions drawn on), so the share of predictions that are real holds can be measured. It reads slightly low: a few predictions counted as wrong sit on a real hold but do not overlap its label enough.

| Photo | Holds labelled | Found | Marks that are real holds | In training? |
|---|---|---|---|---|
| boulderhaus-phone/126.jpg | 34 | 97% | 100% | wall not in training; closest 0090.jpg (29 matched details) |
| boulderhaus-phone/182.jpg | 39 | 95% | 90% | same wall as training photo 191_left.jpg (39 matched details) |
| boulderhaus-camera/0000.jpg | 76 | 84% | 90% | this photo is in the validation set; same wall as training photo 0106.jpg (44 matched details) |
| boulderhaus-camera/0003.jpg | 9 | 89% | 89% | same wall as training photo 0106.jpg (13 matched details) |
| boulderhaus-camera/0006.jpg | 325 | 67% | 97% | same wall as training photo 1029.jpg (218 matched details) |
| boulderhaus-camera/0074.jpg | 249 | 87% | 98% | same wall as training photo 0046.jpg (376 matched details) |
| boulderhaus-camera/0075.jpg | 63 | 100% | 98% | same wall as training photo 0056.jpg (151 matched details) |
| boulderhaus-camera/0132.jpg | 54 | 94% | 84% | same wall as training photo 0147.jpg (110 matched details) |
| boulderhaus-camera/0274.jpg | 87 | 80% | 93% | same wall as training photo 0275.jpg (66 matched details) |
| boulderhaus-camera/0457.jpg | 83 | 99% | 99% | same wall as training photo 0465.jpg (95 matched details) |
| boulderhaus-camera/0502.jpg | 73 | 92% | 93% | same wall as training photo 1015.jpg (189 matched details) |
| boulderhaus-camera/0518.jpg | 51 | 96% | 89% | same wall as training photo 0925.jpg (157 matched details) |
| boulderhaus-camera/0530.jpg | 60 | 97% | 92% | same wall as training photo 0925.jpg (358 matched details) |
| boulderhaus-camera/0647.jpg | 64 | 91% | 88% | same wall as training photo 0646.jpg (223 matched details) |
| boulderhaus-camera/0689.jpg | 124 | 92% | 97% | same wall as training photo 0758.jpg (421 matched details) |
| boulderhaus-camera/0917.jpg | 85 | 94% | 94% | same wall as training photo 0732.jpg (154 matched details) |
| boulderhaus-camera/1037.jpg | 84 | 90% | 94% | same wall as training photo 0179.jpg (68 matched details) |
| smichoff-camera/082.jpg | 25 | 100% | 93% | same wall as training photo 819.jpg (19 matched details) |
| smichoff-camera/108.jpg | 103 | 93% | 97% | same wall as training photo 089_.jpg (42 matched details) |

## Not measured

- Grade error on real gym routes: there is no gym route with a known grade in the data.
- Hold finding on hand-labelled photos of a gym the finder has never seen. The ClimbInst test photos are the nearest thing.
- Route grouping on the hold finder's own output (the route test uses hand-labelled holds).
- Whether the solved move sequence is the one climbers really use: there is no record of real sequences to compare with.
- The "foot only" hold type: the type data has no such label.
