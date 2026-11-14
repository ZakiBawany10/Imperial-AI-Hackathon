# Indoor bouldering wall photos

297 real photographs showing holds and routes on indoor bouldering walls. The collection covers Boulderhaus in Heidelberg, Germany, and Smíchoff in Prague, Czech Republic.

| Gym and camera | Photos |
| --- | ---: |
| Boulderhaus, Nikon camera | 123 |
| Boulderhaus, phone camera | 53 |
| Smíchoff, Nikon camera | 121 |

## Files

- `images/` contains JPEG photos at up to 1,920 pixels on the longest edge. Photos were oriented using their EXIF data, resized and re-encoded at high quality. No crops, overlays, or synthetic variants were added.
- `manifest.csv` maps every photo to its source filename, download URL, creator, dimensions, annotation status, and SHA-256 checksum.
- `annotations/holds-and-routes.json` contains 1,688 source hold and volume polygons across 19 photos. 8 of those photos contain route IDs for some or all of the labeled holds. The coordinates were scaled to match the included JPEGs. Route IDs apply within each image. They do not encode grades, start and finish holds, or guarantee that a complete route is visible.

## Selection

The source contains 2,273 photographs across three series. A 515-photo sample spread across the three series was checked on contact sheets. Floor-dominant views, bare walls, very dark photos and visibly redundant angles were culled. Source-annotated photos were retained, including some tightly framed or dark views. Exact hashes and perceptual image comparisons were also checked.

Many photos show multiple overlapping problems. The same walls and sets appear from different viewpoints. This collection is a set of photos, not a count of unique routes.

## Source and attribution

Credit Tomáš Sláma, [Indoor Climbing Gym Hold And Route Segmentation, version 4](https://www.kaggle.com/datasets/tomasslama/indoor-climbing-gym-hold-segmentation). The version 4 Kaggle listing states [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). This collection resizes and re-encodes the photos and scales the annotation coordinates.

The [associated project paper](https://github.com/xiaoxiae/Indoor-Climbing-Hold-and-Route-Segmentation/blob/main/paper/main.tex) describes the Kaggle dataset using a noncommercial ShareAlike label. This archive records the license shown on the download listing at collection time. The two publisher statements differ.
