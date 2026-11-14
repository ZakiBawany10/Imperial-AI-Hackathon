# 600 additional indoor bouldering wall photographs

This second batch contains 600 additional photographs from Tomáš Sláma's [Indoor Climbing Gym Hold And Route Segmentation, version 4](https://www.kaggle.com/datasets/tomasslama/indoor-climbing-gym-hold-segmentation).

| Gym and camera | Photos |
| --- | ---: |
| Boulderhaus, Nikon camera | 296 |
| Boulderhaus, phone camera | 19 |
| Smíchoff, Nikon camera | 285 |

The images were visually screened for visible climbing holds and wall sections. Similar compositions were culled by comparing perceptual fingerprints and thumbnail similarity against the first 297 photos and within this batch. The collection includes different angles of some of the same walls. Many photos show several overlapping problems. This batch contains no source route IDs or hold outlines.

JPEGs in `images/` were oriented using EXIF data, resized to at most 1,920 pixels on the longest edge, and re-encoded. `manifest.csv` records the source file, creator, download URL, license, dimensions and SHA-256 checksum of each photo.

The version 4 Kaggle download listing states [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The [associated paper](https://github.com/xiaoxiae/Indoor-Climbing-Hold-and-Route-Segmentation/blob/main/paper/main.tex) describes the dataset using a noncommercial ShareAlike label. The manifest records the license shown on the download listing.
