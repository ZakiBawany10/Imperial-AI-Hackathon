# 300 graded indoor gym problems

300 distinct route records from Alt. Rock in Barrie, Ontario. Every route has an exact gym-published V grade. The underlying photos show real, non-standardized gym walls.

- 187 routes have a per-route JPEG overlay showing the gym's hold points. Green circles are starts, white circles are intermediate holds, and pink circles are finishes. Grades are stored in the CSV and do not appear in these overlays.
- 113 routes have a wall photo and a source hold color. The same wall photo can serve multiple color-identified routes. These rows have no confirmed per-hold positions.
- There are 91 unique base wall photos across 91 published wall rotations. All base photos are included without the added markers. They were oriented and resized to a maximum of 1600 pixels on the longer edge.
- The CSV includes the source grade, route ID, hold color, wall rotation, photo URL, checksums, and hold center coordinates when available. Coordinates are percentage or image-pixel distances from the top-left. The gym's points mark positions, so the circles do not represent exact hold outlines.

Split model evaluation by wall rotation or by wall to keep shared base photos on one side of the split. Grade tags may be present on the physical walls. For the color-only rows, the hold color in the CSV identifies which problem to grade.

[Alt. Rock public archive](https://www.boulderbase.app/gyms/alt-rock). Photos and route data are credited to Alt. Rock via BoulderBase. I found no explicit permission for model training in the published source. [BoulderBase terms](https://www.boulderbase.app/terms).
