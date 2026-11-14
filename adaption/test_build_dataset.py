"""Tests for build_dataset.py on a tiny synthetic scrape. No download needed.

    python3 -m unittest test_build_dataset.py
"""

import csv
import pickle
import tempfile
import unittest
from pathlib import Path

import build_dataset as bd

try:
    import numpy  # noqa: F401
    import sklearn  # noqa: F401
    HAVE_SKLEARN = True
except ImportError:
    HAVE_SKLEARN = False


def fake_problem(grade, start, mid, end, repeats=3, benchmark=False):
    return {
        "url": "https://moonboard.com/Problems/View/1/secret-name",
        "start": start, "mid": mid, "end": end,
        "grade": grade, "user_grade": None, "is_benchmark": benchmark,
        "repeats": repeats, "problem_type": None, "is_master": False,
        "setter": {"Nickname": "nick", "Firstname": "First", "Lastname": "Last", "City": "Townsville",
                   "Country": "Nowhere", "ProfileImageUrl": "/x.gif"},
    }


class BuildDatasetTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.raw, self.out = root / "raw", root / "out"
        self.raw.mkdir()
        problems = {
            "1": fake_problem("6B+", [[5, 4]], [[5, 8], [3, 12]], [[4, 17]]),
            "2": fake_problem("7A", [[2, 3], [3, 3]], [[6, 9]], [[8, 17]]),
            "3": fake_problem("7A", [[2, 3], [3, 3]], [[6, 9]], [[8, 17]], repeats=9),  # same holds as "2": kept, like Krishna
            "4": fake_problem("6C", [[1, 2]], [[1, 9]], [[1, 17]], repeats=1),          # under 2 repeats
            "5": fake_problem("7B", [[1, 2]], [[2, 9]], [[3, 17]], repeats=0, benchmark=True),  # benchmarks not exempt
            "6": fake_problem("9Z", [[1, 2]], [[2, 9]], [[3, 17]]),                      # unknown grade
            "7": fake_problem("6C", [[1, 2]], [[1, 2]], [[3, 17]]),                      # same hold listed twice
            "8": fake_problem("6C", [], [[1, 9]], [[3, 17]]),                            # no start hold
        }
        (self.raw / "moonGen_scrape_2016_final").write_bytes(pickle.dumps(problems, protocol=2))
        for name in ("HoldFeature2016LeftHand.csv", "HoldFeature2016RightHand.csv"):
            with (self.raw / name).open("w", newline="") as f:
                w = csv.writer(f)
                w.writerow(["X_coord", "Y_coord", "Difficulties"])
                for x in range(11):
                    for y in range(18):
                        w.writerow([x, y, (x + y) % 10])

    def tearDown(self):
        self.tmp.cleanup()

    def read(self, name):
        with (self.out / name).open(newline="") as f:
            return list(csv.DictReader(f))

    def test_filter_matches_krishna(self):
        stats = bd.build(self.raw, self.out, split="hash", test_fraction=0.0, split_ids=None)
        self.assertEqual(stats["dropped"], {"unknown grade or no start/finish": 2, "fewer than 2 repeats": 2,
                                            "same hold listed twice": 1})
        train = self.read("train.csv")
        self.assertEqual([r["response"] for r in train], ["6B+", "7A", "7A"])  # pickle order kept
        self.assertEqual(list(train[0].keys()), ["instruction", "response"])

    def test_split_ids_file_has_only_id_and_grade(self):
        ids = Path(self.tmp.name) / "ids.csv"
        bd.build(self.raw, self.out, split="hash", test_fraction=1.0, split_ids=ids)
        with ids.open(newline="") as f:
            rows = list(csv.DictReader(f))
        self.assertEqual(list(rows[0].keys()), ["problem_id", "grade"])
        self.assertEqual(sorted(r["problem_id"] for r in rows), ["1", "2", "3"])

    @unittest.skipUnless(HAVE_SKLEARN, "needs numpy + scikit-learn (adaption/.venv)")
    def test_krishna_split_is_stratified_and_deterministic(self):
        kept = [{"grade": g} for g in ["6B+"] * 10 + ["7A"] * 10]
        a, b = bd.split_krishna(kept), bd.split_krishna(kept)
        self.assertEqual(a, b)
        self.assertEqual(len(a), 4)
        self.assertEqual(sum(kept[i]["grade"] == "7A" for i in a), 2)

    def test_hold_difficulty_runs_high_score_good(self):
        # The fixture scores hold (x, y) as (x + y) % 10, so (0, 9) scores 9 (best hold).
        diff = bd.load_hold_difficulty(self.raw)
        self.assertEqual(diff[(0, 9)], 0)
        self.assertEqual(diff[(0, 0)], 9)

    def test_baseline_matches_numpy_median(self):
        b = bd.baseline(["6B+", "6C", "7A", "7B"], ["6C", "6C+"])  # median index 3.0 between 6C (2) and 7A (4)
        self.assertEqual(b["mae"], 0.5)
        self.assertEqual(b["exact"], 0.5)

    def test_no_personal_fields_in_output(self):
        bd.build(self.raw, self.out, split="hash", min_repeats=0, test_fraction=0.5, split_ids=None)
        text = (self.out / "train.csv").read_text() + (self.out / "test.csv").read_text()
        for leak in ("nick", "First", "Last", "Townsville", "Nowhere", "secret-name", "moonboard.com", ".gif"):
            self.assertNotIn(leak, text)

    def test_split_is_deterministic(self):
        self.assertEqual(bd.in_test_split("367894", 0.1), bd.in_test_split("367894", 0.1))
        self.assertFalse(bd.in_test_split("anything", 0.0))
        self.assertTrue(bd.in_test_split("anything", 1.0))

    def test_refuses_pickles_that_import_classes(self):
        bad = self.raw / "moonGen_scrape_2016_final"
        bad.write_bytes(pickle.dumps({"1": Path("/tmp")}))
        with self.assertRaises(pickle.UnpicklingError):
            bd.load_problems(bad)

    def test_describe_route_wording(self):
        holds = [
            {"x_m": 0.0, "y_m": 0.0, "difficulty": 2, "role": "start"},
            {"x_m": 0.4, "y_m": 0.6, "difficulty": 8, "role": "mid"},
            {"x_m": 0.0, "y_m": 0.6, "difficulty": 5, "role": "mid"},
            {"x_m": 0.0, "y_m": 1.2, "difficulty": 1, "role": "finish"},
        ]
        text = bd.describe_route(holds, 40)
        self.assertIn("4 hand holds, 1 start and 1 finish.", text)
        self.assertIn("Height climbed 1.2 m.", text)
        self.assertIn("Start on a 2, then up 0.6 m to a 5; right 0.4 m to an 8; up 0.6 m left 0.4 m to a 1.", text)


if __name__ == "__main__":
    unittest.main()
