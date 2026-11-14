# BetaCrux 3D viewer

The wall, its holds and the climber in 3D. One ES module, no build step, no network (three.js 0.160, MIT, is in `vendor/`).
Import it straight from the backend (any origin is allowed) or copy this folder. Demo: `/demo/3d.html` on the backend (`?live=1` asks the server itself).
```html
<div id="wall3d" style="width:100%; height:70vh"></div>   <!-- the container needs a height; the viewer fills it -->
<script type="module">
  import { mountViewer } from "/demo/viewer/betacrux-viewer.js";
  const viewer = mountViewer(document.getElementById("wall3d"), { imageUrl, analyze, solveRequest, solve });
  viewer.on("move", (i) => console.log("move", i, "started"));
</script>
```
Options: `imageUrl` the wall photo; `analyze` the `POST /analyze` answer; `solveRequest` the body sent to `POST /solve`; `solve` its answer.
Leave out `solve` (and `solveRequest`) to show the wall and holds only. Today's answers work as they are; foot moves, `contacts`,
`physics` (force arrows, balance point, effort) and hold `outline` are drawn when present. Also: `view: "photo" | "schematic"`,
`autoplay`, `loop`, `speed`, `hud: false` (hide every panel and button, to draw your own), `sway: false` (no slow camera drift),
`bloom: false` (no glow, for slow machines), `wallHeightM` and `wallAngleDeg` (used when there is no `solveRequest`).

- `setSolve(solveRequest, solve)`: show a new route or answer, for example after the height slider moves. Either may be `null`.
- `play()`, `pause()`, `setSpeed(x)`; the animation loops. `seek(i)`: jump to move `i` (0 is the first); while paused it plays that one move and stops; `seek(i, { animate: false })` shows its end position at once.
- `on("move", fn)`: `fn(moveIndex)` as each move starts; also `"loop"`, `"end"`, `"ready"`. Returns a function that removes the listener.
- `setView("schematic")`, `setFollow(true)` (camera stays on the climber), `setCamera({ azimuth, elevation, zoom, target })`, `resetView()`.
- `state()` gives `{ move, of, playing, ... }`; `stats()` gives `{ fps, drawCalls, triangles, ... }`; `resize()`; `dispose()` before mounting again.
- Text helpers: `gradeBand("6a+")` is `"Intermediate"`; `describeMove(move, hold)` is `"Right hand to a big easy grip"`; `HOLD_LABEL`.
  `sample/` is a hand-made answer with the planned fields (made-up test numbers from `sample/make_sample.mjs`, not the real physics).
