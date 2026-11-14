"""Build the Adaption fine-tune dataset: short text description of a climb -> grade.

    .venv/bin/python build_dataset.py              # Krishna's filter and split (needs numpy + scikit-learn)
    python3 build_dataset.py --split hash          # standard library only, NOT Krishna's rows

Source: MoonBoard 2016 problems scraped by github.com/jrchang612/MoonBoardRNN
(Apache-2.0), file raw_data/moonGen_scrape_2016_final, plus that repo's expert
per-hold scores HoldFeature2016LeftHand.csv and HoldFeature2016RightHand.csv.
Put all three in data/raw/ (see README.md).

Rows match Krishna's grade-model evaluation exactly (backend/test_thesis.py and
backend/train_grade.py, read 2026-11-14):
    keep a problem if its grade is 6B..8B+, it has start and finish holds,
    repeats >= 2, and no hold appears twice in it; problems kept in the pickle's
    order; split with sklearn train_test_split(test_size=0.2, random_state=0,
    stratify=grade index). Same function, same inputs, so the same rows.

Writes:
    out/train.csv          instruction, response                (the file to upload)
    out/test.csv           instruction, response, problem_id, is_benchmark, repeats, user_grade
                           (held out; never uploaded; used to score the fine-tuned model)
    out/stats.json         counts, grade distribution, median-guess baseline on the test split
    test_split_ids.csv     problem_id, grade for every test row (committed, so anyone can
                           check they are scoring on the same rows)

Privacy: the scrape includes each setter's name, nickname, city, country and
profile image, and a URL containing the problem's name. None of that is read
into the output. Only hold positions, grade, benchmark flag, repeat count and
the numeric problem id are used.

The pickle is loaded with every class import blocked, so a tampered file cannot
run code; it contains only dicts, lists, strings and numbers.
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
SPLIT_IDS = HERE / "test_split_ids.csv"

# MoonBoard 2016: 40 degree overhang, 11 x 18 grid of hold positions, about
# 0.2 m apart (the same figure Krishna's beta_solver.py uses).
GRID_M = 0.2
BOARD_ANGLE_DEG = 40

# Font grades in order, so errors can be counted in grade steps. Same list as Krishna's.
GRADES = ["6B", "6B+", "6C", "6C+", "7A", "7A+", "7B", "7B+", "7C", "7C+", "8A", "8A+", "8B", "8B+"]
GRADE_INDEX = {g: i for i, g in enumerate(GRADES)}

# Krishna's filter and split (backend/test_thesis.py, backend/train_grade.py).
MIN_REPEATS = 2
TEST_SIZE = 0.2
SEED = 0

DEFAULT_DIFFICULTY = 4.5  # for a hold position missing from the expert tables (one in the whole scrape)


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
    """(x, y) -> hold difficulty, 0 (best hold) to 9 (worst), averaged over both hands.

    The expert tables score holds 0..9 with HIGH = GOOD. Krishna checked the
    direction against grades in backend/test_thesis.py (correlation 0.556,
    results.json), so difficulty = 9 - score. This matches her "badness"
    1 - score / 9, scaled to 0..9.
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
    return {k: 9 - statistics.mean([t[k] for t in per_hand if k in t]) for k in keys}


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


def keep_problems(problems: dict, min_repeats: int) -> tuple[list[dict], Counter]:
    """Krishna's filter, in the pickle's order. Setter details and the URL are never read."""
    kept, dropped = [], Counter()
    for pid, p in problems.items():
        if p.get("grade") not in GRADE_INDEX or not p.get("start") or not p.get("end"):
            dropped["unknown grade or no start/finish"] += 1
            continue
        if (p.get("repeats") or 0) < min_repeats:
            dropped[f"fewer than {min_repeats} repeats"] += 1
            continue
        holds = [tuple(h) for h in p["start"] + p["mid"] + p["end"]]
        if len(set(holds)) != len(holds):
            dropped["same hold listed twice"] += 1
            continue
        kept.append({
            "problem_id": str(pid),
            "start": [tuple(h) for h in p["start"]],
            "mid": [tuple(h) for h in p["mid"]],
            "end": [tuple(h) for h in p["end"]],
            "grade": p["grade"],
            "user_grade": p.get("user_grade") if p.get("user_grade") in GRADE_INDEX else "",
            "is_benchmark": bool(p.get("is_benchmark")),
            "repeats": int(p.get("repeats") or 0),
        })
    return kept, dropped


def split_krishna(kept: list[dict], test_size: float = TEST_SIZE, seed: int = SEED) -> set[int]:
    """Indices of the test rows, exactly as Krishna's scripts choose them."""
    import numpy as np  # only this split needs numpy and scikit-learn
    from sklearn.model_selection import train_test_split

    y = np.array([GRADE_INDEX[p["grade"]] for p in kept], dtype=float)
    _, te = train_test_split(np.arange(len(kept)), test_size=test_size, random_state=seed, stratify=y)
    return {int(i) for i in te}


def in_test_split(problem_id: str, fraction: float) -> bool:
    """Deterministic split by hashed problem id. Used only by --split hash."""
    h = int(hashlib.sha256(problem_id.encode()).hexdigest()[:8], 16)
    return h / 0xFFFFFFFF < fraction


def baseline(train_grades: list[str], test_grades: list[str]) -> dict:
    """Always guess the training median, scored the way Krishna scores (backend/test_thesis.py)."""
    if not train_grades or not test_grades:
        return {"median_guess": None, "mae": None, "exact": None, "within1": None}
    tr = sorted(GRADE_INDEX[g] for g in train_grades)
    n = len(tr)
    median = tr[n // 2] if n % 2 else (tr[n // 2 - 1] + tr[n // 2]) / 2  # same as numpy.median
    pred = min(max(round(median), 0), len(GRADES) - 1)  # numpy.rint rounds half to even, like round()
    te = [GRADE_INDEX[g] for g in test_grades]
    return {
        "median_guess": GRADES[pred] if median == pred else f"{median} (between {GRADES[int(median)]} and {GRADES[int(median) + 1]})",
        "mae": round(statistics.mean(abs(t - median) for t in te), 3),
        "exact": round(statistics.mean(t == pred for t in te), 3),
        "within1": round(statistics.mean(abs(t - pred) <= 1 for t in te), 3),
    }


def build(raw: Path, out: Path, split: str = "krishna", min_repeats: int = MIN_REPEATS,
          test_fraction: float = TEST_SIZE, split_ids: Path | None = SPLIT_IDS) -> dict:
    problems = load_problems(raw / "moonGen_scrape_2016_final")
    difficulty = load_hold_difficulty(raw)
    kept, dropped = keep_problems(problems, min_repeats)

    if split == "krishna":
        test_idx = split_krishna(kept, test_fraction, SEED)
    elif split == "hash":
        test_idx = {i for i, p in enumerate(kept) if in_test_split(p["problem_id"], test_fraction)}
    else:
        raise ValueError(f"unknown split {split!r}")

    train, test = [], []
    for i, p in enumerate(kept):
        row = {
            "instruction": describe_route(moonboard_holds(p, difficulty), BOARD_ANGLE_DEG),
            "response": p["grade"],
        }
        if i in test_idx:
            test.append({**row, "problem_id": p["problem_id"], "is_benchmark": p["is_benchmark"],
                         "repeats": p["repeats"], "user_grade": p["user_grade"]})
        else:
            train.append(row)

    out.mkdir(parents=True, exist_ok=True)
    write_csv(out / "train.csv", train, ["instruction", "response"])
    write_csv(out / "test.csv", test, ["instruction", "response", "problem_id", "is_benchmark", "repeats", "user_grade"])
    if split_ids is not None:
        write_csv(split_ids, [{"problem_id": r["problem_id"], "grade": r["response"]} for r in test],
                  ["problem_id", "grade"])

    by_grade = lambda rows: dict(sorted(Counter(r["response"] for r in rows).items(), key=lambda kv: GRADE_INDEX[kv[0]]))
    stats = {
        "source_problems": len(problems),
        "kept": len(kept),
        "dropped": dict(dropped),
        "train_rows": len(train),
        "test_rows": len(test),
        "test_benchmarks": sum(r["is_benchmark"] for r in test),
        "grades_train": by_grade(train),
        "grades_test": by_grade(test),
        "baseline_median_guess_on_test": baseline([r["response"] for r in train], [r["response"] for r in test]),
        "settings": {"split": split, "min_repeats": min_repeats, "test_fraction": test_fraction, "seed": SEED,
                     "grid_m": GRID_M, "wall_angle_deg": BOARD_ANGLE_DEG},
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
    ap.add_argument("--split", choices=["krishna", "hash"], default="krishna",
                    help="krishna: her exact test rows (needs numpy + scikit-learn); hash: stdlib only, different rows")
    ap.add_argument("--min-repeats", type=int, default=MIN_REPEATS,
                    help=f"default {MIN_REPEATS}, Krishna's value; changing it changes the rows")
    ap.add_argument("--test-fraction", type=float, default=TEST_SIZE)
    args = ap.parse_args()
    if args.split != "krishna" or args.min_repeats != MIN_REPEATS or args.test_fraction != TEST_SIZE:
        print("NOTE: these settings do not reproduce Krishna's test rows; test_split_ids.csv is not written.")
    keep_ids = args.split == "krishna" and args.min_repeats == MIN_REPEATS and args.test_fraction == TEST_SIZE
    stats = build(args.raw, args.out, args.split, args.min_repeats, args.test_fraction,
                  SPLIT_IDS if keep_ids else None)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
