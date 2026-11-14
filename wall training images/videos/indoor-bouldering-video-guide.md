# Indoor bouldering video sources

The manifest contains **473 graded clips and timestamped segments** covering 39 venue labels. These include 447 YouTube uploads, 15 Brooklyn Uprising send pages, 10 segments from a climber’s blog, and one Wikimedia Commons clip. Each row links to the video and its grade evidence. The 378 single grades and 95 grade ranges are marked in `grade_kind`. One clip uses a Font grade, and grade modifiers such as V8+ are retained.

## Public clips

- **Gym route records.** Brooklyn Uprising hosts 15 member-filmed ascents with a grade on each video page. [Brooklyn Uprising sends](https://www.bkup.nyc/feed)
- **Timestamped grades.** Ten sections of one video cover Urbana Boulders, Benchmark Berkeley and Mosaic Boulders. The grade and gym appear on screen. `start_seconds` and `end_seconds` specify the clip in the shared MP4. [Climbing, trusting, and progressing](https://blog.tjtl.io/climbing-trusting-progressing/)
- **Short graded ascents.** Most entries are YouTube uploads whose titles identify the grade of a single problem. The catalog records where the gym was identified and whether the uploader explicitly reported a send. [Example at Momentum SODO](https://www.youtube.com/watch?v=0-Zx2ilXR8c)
- **Openly licensed example.** A 46-second Rock Spot V3 from Cryptic C62 is published under CC BY-SA 3.0. The source resolution is 204 × 360. [File, credit and license](https://commons.wikimedia.org/wiki/File:Indoor_Bouldering_V3_Rock_Spot.webm)

The YouTube links returned public oEmbed metadata when checked. Sampled frames showed both a climber and gym wall in 111 entries across all sources. Other entries were screened using source metadata or gym listings. Camera visibility, the full start-to-finish sequence, and successful completion were not confirmed for every clip. Rows are unique by video link or timestamp, and different uploads may show the same climb. Clear board, roped and outdoor entries were excluded during screening. The manifests contain links and source labels, with no transcript or video mirrors. The `license` field says `unverified` when reuse rights were not established. [YouTube terms](https://www.youtube.com/t/terms)

## Ego-Exo4D for a larger training set

Ego-Exo4D reports **1,401 rock-climbing takes** in the dataset overview. At the Colombian gym, researchers used 33 setter-graded V1–V7 problems and four external cameras. Takes may contain several attempts on the same problem. The project also provides synchronized views, selected pose annotations and time-indexed narration. [Dataset overview](https://ego-exo4d-data.org/) · [Collection protocol](https://ego-exo4d-data.org/paper/ego-exo4d-supp.pdf)

The documented sample `LosAndes_V2_R1` has a route grade of V2 in `task_name`. Its `proficiency_score` describes the climber’s skill. The sample is joined to four external-camera files by `take_uid`. Grade coverage in the full release requires access to its metadata. [Annotation example](https://docs.ego-exo4d-data.org/annotations/proficiency_estimation/) · [Take metadata](https://docs.ego-exo4d-data.org/data/metadata/)

1. Request free access through Lab22. The project says credentials typically arrive in about 48 hours after the license agreement. [Access instructions](https://docs.ego-exo4d-data.org/getting-started/)
2. After configuring the credentials and installing the official downloader, download the metadata. Filter `takes.json` to bouldering, then look for explicit route grades in `task_name`. Use `best_exo` when present to choose a camera and preserve the site and route identifier with the grade. [Downloader and filters](https://docs.ego-exo4d-data.org/download/) · [Metadata fields](https://docs.ego-exo4d-data.org/data/metadata/)
3. Download external views only, starting with the documented V2 take. Substitute the chosen take IDs for a larger download. [Downscaled video files](https://docs.ego-exo4d-data.org/data/downscaled_takes/)

```sh
egoexo -o egoexo-bouldering --release v2 --parts metadata
egoexo -o egoexo-bouldering --release v2 --parts downscaled_takes/448 \
  --views exo --uids 000a19fe-776e-4c88-b0c3-2fad016a6025
```

For grade prediction, split by route or gym before extracting frames. Repeated attempts and different camera angles of the same climb belong in the same split. Grade text and narration can supply labels. Remove or mask them in model inputs if the goal is to infer grade from the climbing movement.
