# For Krishna, from Adam

## The 3D camera feels too zoomed out on Play

When the beta plays, the whole wall is in view and the climb is small and hard to follow, especially on a
phone. It should open a little closer, on the climb, with the whole climb still in view (it doesn't need to be
tight; people can zoom by hand).

The frontend can't do this itself: `setCamera` only zooms about the middle of the wall or onto the climber, so
a climb near the edge or one that runs floor to top can't be framed.

**Ask** (`backend/demo/viewer/betacrux-viewer.js`): a `mountViewer` option `frame: "climb"` (default stays
`"wall"`, so `3d.html` is unchanged). When a solve is shown, `fitCamera` frames the climb instead of the wall:

- Box = the route's holds (`solveRequest.holds`) plus every keyframe's joints, so the start on the floor and the
  big reaches are in. About 15% margin.
- Target = the box centre (with the relief depth). Distance = the larger of `boxH / (2·tan(fov/2))` and
  `boxW / (2·tan(fov/2)·aspect)`, never further out than the whole-wall view and never closer than a box about
  2 m tall. Same azimuth and elevation as now.
- Reset view, resize and `setSolve` (re-solve) use the same framing, so "Reset view" goes back to the climb.

Tell Adam when it's in; the frontend will pass `frame: "climb"` from Play (one line in `src/screens/Play.tsx`).
