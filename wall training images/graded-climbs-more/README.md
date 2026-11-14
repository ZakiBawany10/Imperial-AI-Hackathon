# More graded indoor bouldering wall photos

211 additional photos, one per source problem, with a grade or published circuit range. All show indoor gym walls.

| Source location | Photos |
| --- | ---: |
| Seattle Bouldering Project - Poplar | 176 |
| VITAL Brooklyn | 11 |
| Seattle Bouldering Project - Fremont | 17 |
| The A | 4 |
| Stanford Climbing Gym | 3 |

## Files

- `photos/circuit-ranges/` holds 204 wchargin climbing-journal photos. The journal provides a circuit and grade range per pictured problem. Ranges are stored in `grade_min` and `grade_max` without assigning a midpoint. The route is generally identified by hold color. Some walls show several overlapping routes. The original 1,200-pixel variants are included.
- `photos/exact-grades/` holds 7 individually graded photos. Four are guidebook crops from The A with outlined holds. Three are examples from a Stanford research paper with the target route specified by color. The Stanford photos contain visible grade tags.
- `annotations/journal-hold-boxes.json` supplies the original journal annotations for 10 photos. Some are partial. Annotation coordinates are in the source viewBox.
- `labels.csv` gives the grade label, grade bounds, route or circuit color, location, source, and SHA-256 for each photo. Individual-grade and circuit-range labels use separate values in `label_type`.

## Sources

- [wchargin route gallery](https://wchargin.com/climbing/) and its linked [Seattle circuit chart](https://storage.googleapis.com/wchargin-climbing-public/assets/sbp-circuits.jpg). The historical VITAL range comes from the journal's Summer 2022 description. The VITAL circuit tag can differ from the actual hold color, which is recorded when the journal identifies it.
- [The A's 2024 mini-guide](https://static1.squarespace.com/static/5ba1695e4eddec6fcd1f6099/t/65e734adf1fcd9029a72c65a/1709651125823/The%2BA%2BGuidebook%2Bv.09.pdf). The four included routes are absent from the previously delivered collection.
- [Stanford CS231n paper by Jack Hlavka and Ethan Harianto](https://cs231n.stanford.edu/2024/papers/related-task-self-supervised-learning-for-rock-climbing-route-ra.pdf), figures 1 and 7.

The source pages identify the images and grades. I found no explicit license for model training for these images. Color-based circuit labels can make it easy for a model to learn a gym's color convention. The individual grade labels in the Stanford photos are also visible in the image. The manifest flags these cases for filtering.
