"""Build the Adaption fine-tune dataset: short text description of a climb -> grade.

    python3 build_dataset.py                 # reads data/raw/, writes out/
    python3 build_dataset.py --min-repeats 0 --test-fraction 0.1

Source: MoonBoard 2016 problems scraped by github.com/jrchang612/MoonBoardRNN
(Apache-2.0), file raw_data/moonGen_scrape_2016_final, plus that repo's per-hold
difficulty tables HoldFeature2016LeftHand.csv and HoldFeature2016RightHand.csv.
Put all three in data/raw/ (see README.md).

Writes:
    out/train.csv   columns: instruction, response          (the file to upload)
    out/test.csv    instruction, response + problem_id, is_benchmark, repeats, user_grade
                    (held out; never uploaded; used to score the fine-tuned model)
    out/stats.json  counts, grade distribution, median-guess baseline on the test split

Privacy: the scrape includes each setter's name, nickname, city, country and
profile image, and a URL containing the problem's name. None of that is read
into the output. Only hold positions, grade, benchmark flag, repeat count and
the numeric problem id are used.

Standard library only. The pickle is loaded with every class import blocked,
so a tampered file cannot run code; it contains only dicts, lists, strings and
numbers.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import pickle
import statistics
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "data" / "raw"
OUT = HERE / "out"

# MoonBoard 2016: 40 degree overhang, 11 x 18 grid of hold positions.
# ASSUMPTION: about 0.2 m between neighbouring grid positions. The exact value
# only rescales distances; it must be the same here and at prediction time.
GRID_M = 0.2
BOARD_ANGLE_DEG = 40

# Font grades in order, so errors can be counted in grade steps.
GRADES = ["6B", "6B+", "6C", "6C+", "7A", "7A+", "7B", "7B+", "7C", "7C+", "8A", "8A+", "8B", "8B+"]
GRADE_INDEX = {g: i for i, g in enumerate(GRADES)}

DEFAULT_DIFFICULTY = 5  # for the one hold position missing from the difficulty tables


class _NoClassesUnpickler(pickle.Unpickler):
    def find_class(self, module, name):  # noqa: D401
        raise pickle.UnpicklingError(f"refusing to load class {module}.{name}")


def load_problems(path: Path) -> dict:
    with path.open("rb") as f:
        data = _NoClassesUnpickler(f).load()
    if not isinstance(data, dict):
        raise ValueError(f"expected a dict of problems, got {type(data).__name__}")
    return data


def load_hold_difficulty(raw: Path) -> dict[tuple[int, int], float]:
    """(x, y) -> mean of left- and right-hand difficulty, 0 (easy) to 9 (hard).

    ASSUMPTION: higher 'Difficulties' means a harder hold. The source repo does
    not document the scale; it is consistent with jugs on the low rows.
    """
    per_hand: list[dict[tuple[int, int], int]] = []
    for name in ("HoldFeature2016LeftHand.csv", "HoldFeature2016RightHand.csv"):
        table = {}
        with (raw / name).open(encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                if row.get("X_coord") and row.get("Difficulties"):
                    table[(int(row["X_coord"]), int(row["Y_coord"]))] = int(row["Difficulties"])
        per_hand.append(table)
    keys = set(per_hand[0]) | set(per_hand[1])
    return {
        k: statistics.mean([t[k] for t in per_hand if k in t])
        for k in keys
    }


def describe_route(holds: list[dict], wall_angle_deg: float) -> str:
    """One short paragraph describing a route, in units BetaCrux can also produce.

    holds: [{"x_m": float, "y_m": float, "difficulty": 0..9, "role": "start" | "mid" | "finish"}]
           x_m to the right, y_m upwards, in metres. Roles mark start and finish holds.

    This is deliberately independent of the MoonBoard grid, so the same function
    can describe a gym route solved by BetaCrux (difficulty = 9 * (1 - quality)).
    Holds are read bottom to top as a stand-in for the move order.
    """
    ordered = sorted(holds, key=lambda h: (h["y_m"], h["x_m"]))
    starts = [h for h in ordered if h["role"] == "start"]
    finishes = [h for h in ordered if h["role"] == "finish"]
    diffs = [h["difficulty"] for h in ordered]

    gaps = []
    steps = []
    for a, b in zip(ordered, ordered[1:]):
        dx, dy = b["x_m"] - a["x_m"], b["y_m"] - a["y_m"]
        gaps.append(math.hypot(dx, dy))
        side = "right" if dx > 0.05 else "left" if dx < -0.05 else None
        if abs(dy) < 0.05:
            move = f"{side or 'across'} {abs(dx):.1f} m"
        else:
            move = f"{'up' if dy > 0 else 'down'} {abs(dy):.1f} m" + (f" {side} {abs(dx):.1f} m" if side else "")
        steps.append(f"{move} to {_a(b['difficulty'])}")

    height = ordered[-1]["y_m"] - ordered[0]["y_m"] if ordered else 0.0
    parts = [
        f"Wall angle {wall_angle_deg:.0f} degrees overhanging.",
        f"{len(ordered)} hand holds, {len(starts)} start and {len(finishes)} finish.",
        f"Height climbed {height:.1f} m.",
        f"Hold difficulty (0 easy, 9 hard): mean {statistics.mean(diffs):.1f}, hardest {max(diffs):.0f}.",
    ]
    if gaps:
        parts.append(f"Longest gap {max(gaps):.1f} m, mean gap {statistics.mean(gaps):.1f} m.")
        parts.append(f"Start on {_a(ordered[0]['difficulty'])}, then " + "; ".join(steps) + ".")
    return " ".join(parts)


def _a(difficulty: float) -> str:
    """'a 6', 'an 8': hold difficulty with its article."""
    n = f"{difficulty:.0f}"
    return f"an {n}" if n in ("8", "11", "18") else f"a {n}"


def moonboard_holds(problem: dict, difficulty: dict[tuple[int, int], float]) -> list[dict]:
    holds = []
    for role, key in (("start", "start"), ("mid", "mid"), ("finish", "end")):
        for x, y in problem[key]:
            holds.append({
                "x_m": x * GRID_M,
                "y_m": y * GRID_M,
                "difficulty": difficulty.get((x, y), DEFAULT_DIFFICULTY),
                "role": role,
            })
    return holds


def in_test_split(problem_id: str, fraction: float) -> bool:
    """Deterministic split by hashed problem id, stable across runs and machines."""
    h = int(hashlib.sha256(problem_id.encode()).hexdigest()[:8], 16)
    return h / 0xFFFFFFFF < fraction


def build(raw: Path, out: Path, min_repeats: int, test_fraction: float) -> dict:
    problems = load_problems(raw / "moonGen_scrape_2016_final")
    difficulty = load_hold_difficulty(raw)

    # Keep only the fields we use. Setter details and the URL are never read.
    kept: dict[tuple, dict] = {}
    dropped = Counter()
    for pid, p in problems.items():
        grade = p.get("grade")
        if grade not in GRADE_INDEX:
            dropped["unknown grade"] += 1
            continue
        if (p.get("repeats") or 0) < min_repeats and not p.get("is_benchmark"):
            dropped[f"fewer than {min_repeats} repeats"] += 1
            continue
        clean = {
            "problem_id": str(pid),
            "start": [tuple(h) for h in p["start"]],
            "mid": [tuple(h) for h in p["mid"]],
            "end": [tuple(h) for h in p["end"]],
            "grade": grade,
            "user_grade": p.get("user_grade") if p.get("user_grade") in GRADE_INDEX else "",
            "is_benchmark": bool(p.get("is_benchmark")),
            "repeats": int(p.get("repeats") or 0),
        }
        # The same hold set can be uploaded more than once: keep the most repeated.
        key = (tuple(sorted(clean["start"])), tuple(sorted(clean["mid"])), tuple(sorted(clean["end"])))
        if key in kept:
            dropped["duplicate hold set"] += 1
            if clean["repeats"] <= kept[key]["repeats"] and not clean["is_benchmark"]:
                continue
        kept[key] = clean

    train, test = [], []
    for p in kept.values():
        row = {
            "instruction": describe_route(moonboard_holds(p, difficulty), BOARD_ANGLE_DEG),
            "response": p["grade"],
        }
        # Benchmarks have the most trusted grades, so they always go to the test split.
        if p["is_benchmark"] or in_test_split(p["problem_id"], test_fraction):
            test.append({**row, "problem_id": p["problem_id"], "is_benchmark": p["is_benchmark"],
                         "repeats": p["repeats"], "user_grade": p["user_grade"]})
        else:
            train.append(row)

    out.mkdir(parents=True, exist_ok=True)
    write_csv(out / "train.csv", train, ["instruction", "response"])
    write_csv(out / "test.csv", test, ["instruction", "response", "problem_id", "is_benchmark", "repeats", "user_grade"])

    # Baseline to beat: always guess the training median grade.
    train_idx = sorted(GRADE_INDEX[r["response"]] for r in train)
    median = train_idx[len(train_idx) // 2] if train_idx else None
    mae = (statistics.mean(abs(GRADE_INDEX[r["response"]] - median) for r in test)
           if test and median is not None else None)
    stats = {
        "source_problems": len(problems),
        "dropped": dict(dropped),
        "train_rows": len(train),
        "test_rows": len(test),
        "test_benchmarks": sum(r["is_benchmark"] for r in test),
        "grades_train": dict(sorted(Counter(r["response"] for r in train).items(), key=lambda kv: GRADE_INDEX[kv[0]])),
        "grades_test": dict(sorted(Counter(r["response"] for r in test).items(), key=lambda kv: GRADE_INDEX[kv[0]])),
        "median_guess": GRADES[median] if median is not None else None,
        "median_guess_mae_grade_steps_on_test": round(mae, 3) if mae is not None else None,
        "settings": {"min_repeats": min_repeats, "test_fraction": test_fraction, "grid_m": GRID_M,
                     "wall_angle_deg": BOARD_ANGLE_DEG},
    }
    (out / "stats.json").write_text(json.dumps(stats, indent=2) + "\n")
    return stats


def write_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--raw", type=Path, default=RAW)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--min-repeats", type=int, default=1,
                    help="drop problems repeated fewer times than this (benchmarks always kept); default 1")
    ap.add_argument("--test-fraction", type=float, default=0.1)
    args = ap.parse_args()
    stats = build(args.raw, args.out, args.min_repeats, args.test_fraction)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
