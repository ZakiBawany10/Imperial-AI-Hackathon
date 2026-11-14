"""Every accuracy number the project has, in one table.

Usage:  .venv/bin/python benchmarks.py        (prints the table and writes BENCHMARKS.md)

Only reads the result files that the experiments wrote; it runs nothing and needs
no model. A result file that does not exist yet is shown as "not measured yet".

    results_detector.json          eval_detector.py     finding holds, ClimbInst test photos
    results_gym_holds.json         eval_gym_holds.py    finding holds, 19 hand-labelled gym photos
    results_type.json              train_type.py        hold type
    results_routes.json            eval_routes.py       which holds belong to one route
    results_grade_model.json       train_grade.py       the served grade model
    results.json                   test_thesis.py       grade experiment, MoonBoard
    results_no_hold_quality.json   test_thesis.py       the same with hold quality removed
    results_kilter.json            test_kilter.py       grade experiment, Kilter board
"""
import glob
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
MISSING = "not measured yet"
KNOWN = ["results_detector.json", "results_gym_holds.json", "results_type.json", "results_routes.json",
         "results_grade_model.json", "results.json", "results_no_hold_quality.json", "results_kilter.json"]
# Plain names for the hold types (the words the app shows).
TYPE_WORDS = {"jug": "big easy grip", "crimp": "thin edge", "sloper": "rounded, no edge", "slope": "rounded, no edge",
              "pinch": "squeeze grip", "pocket": "finger hole", "volume": "big shape", "foot": "foot only"}


def read(name):
    """The parsed file, or None when it is missing or cannot be read."""
    try:
        with open(os.path.join(HERE, name)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def pct(v):
    return MISSING if v is None else f"{v * 100:.0f}%"


def num(v, digits=2):
    return MISSING if v is None else f"{v:.{digits}f}"


def count(v):
    return "" if v is None else f"{v:,}"


def pick(rows, **want):
    """First row whose fields start with the wanted text, or {}."""
    for r in rows or []:
        if all(str(r.get(k, "")).startswith(v) for k, v in want.items()):
            return r
    return {}


def row(what, result, against="", examples="", caveat=""):
    return {"what": what, "result": result, "against": against, "examples": examples, "caveat": caveat}


def missing(what, file, caveat=""):
    return row(what, MISSING, "", "", caveat or f"`{file}` does not exist yet")


# ---------------------------------------------------------------- finding holds

def finding_holds():
    rows = []
    det, gym = read("results_detector.json"), read("results_gym_holds.json")
    check = (gym or {}).get("climbinst_test_overlap") or {}
    if det is None:
        rows.append(missing("Holds found in photos of walls the hold finder has never seen", "results_detector.json"))
    else:
        served = pick(det, detector="models/holds.pt (tiled)", split="test")
        plain = pick([r for r in det if "tiled" not in r.get("detector", "")], detector="models/holds.pt", split="test")
        zero = pick(det, detector="zero-shot", split="test")
        n = f"{count(served.get('photos'))} photos, {count(served.get('holds'))} holds"
        if check and check.get("photos_at_or_above_wall_match") == 0 and check.get("copies_of_a_training_photo") == 0:
            unseen = ("Checked: no test photo shows a wall that is in a training photo. The photos are from the "
                      "same public dataset (ClimbInst) as the training photos, not from our own gym.")
        else:
            unseen = ("Test photos are from the same public dataset (ClimbInst) as the training photos; whether "
                      "they show the same walls has not been checked.")
        rows.append(row("Holds found in photos of walls the hold finder has never seen (the finder the app uses)",
                        pct(served.get("found")),
                        f"{pct(zero.get('found'))} for an off-the-shelf finder with no training; "
                        f"{pct(plain.get('found'))} for ours without cutting the photo into tiles",
                        n, unseen))
        rows.append(row("Of the things it marks as holds, the share that really are holds (same photos)",
                        pct(served.get("precision")),
                        f"{pct(zero.get('precision'))} off-the-shelf; {pct(plain.get('precision'))} ours without tiles",
                        n, "A person on the wall is marked as holds; photograph the wall empty."))
        if served.get("seconds_per_photo") is not None:
            rows.append(row("Time to find the holds in one photo", f"{served['seconds_per_photo']:.2f} s",
                            f"{num(zero.get('seconds_per_photo'), 1)} s off-the-shelf", n, "On an M5 laptop."))

    what = "Holds found in 19 hand-labelled photos of two real gyms"
    if gym is None:
        rows.append(missing(what, "results_gym_holds.json"))
        return rows
    ind, a = gym.get("independence") or {}, gym.get("all") or {}
    if ind:
        leak = (f"Not an independent test: {ind.get('same_wall_in_training')} of {ind.get('photos')} photos show a "
                f"wall, with the same holds, that is also in a training photo taken from another spot "
                f"({ind.get('copy_in_training')} are training photos themselves). "
                "Read as: new camera angles of walls it already knows.")
    else:
        leak = gym.get("independence_note", "Overlap with the training photos was not checked.")
    n = f"{count(a.get('photos'))} photos, {count(a.get('holds'))} holds"
    rows.append(row(what, pct(a.get("found")), "not compared (the off-the-shelf finder was not run on these)", n, leak))
    if gym.get("labels_complete"):
        rows.append(row("Of the things it marks as holds, the share that really are holds (same 19 photos)",
                        pct(a.get("predictions_real")), "", f"{count(a.get('predictions'))} marked",
                        "Measurable because every hold in these photos is labelled. Same overlap with training."))
    else:
        rows.append(row("Of the things it marks as holds, the share that really are holds (same 19 photos)",
                        "not measurable", "", "", "Only some holds in these photos are labelled."))
    sizes = gym.get("by_size") or {}
    small, big = sizes.get("under 20 px") or {}, sizes.get("over 40 px") or {}
    if small.get("labelled"):
        rows.append(row("Small or far-away holds found (under 20 pixels across in a 1,920-pixel photo), same 19 photos",
                        pct(small.get("found_share")),
                        f"{pct(big.get('found_share'))} for holds over 40 pixels across ({count(big.get('labelled'))} holds)",
                        f"{count(small.get('labelled'))} holds",
                        "This is where the misses are. Stand close enough that holds are not tiny."))
    nc = gym.get("not_a_copy") or {}
    if nc and nc.get("photos") != a.get("photos"):
        rows.append(row("The same, leaving out any photo that is itself a training or validation photo",
                        f"{pct(nc.get('found'))} found, {pct(nc.get('predictions_real'))} of marks real", "",
                        f"{count(nc.get('photos'))} photos, {count(nc.get('holds'))} holds",
                        f"{ind.get('copy_in_validation', 0)} of the 19 is a validation photo (used to choose which "
                        "training checkpoint to keep)."))
    nw = gym.get("new_wall")
    if ind:
        if nw:
            rows.append(row("The same, only photos whose wall is in no training photo (the clean ones)",
                            f"{pct(nw.get('found'))} found, {pct(nw.get('predictions_real'))} of marks real", "",
                            f"{count(nw.get('photos'))} photo(s), {count(nw.get('holds'))} holds",
                            f"Only {pct(ind.get('clean_share'))} of the 19 photos are clean, and in a gym the "
                            "finder has seen. Too few to be a score."))
        else:
            rows.append(row("The same, only photos whose wall is in no training photo (the clean ones)",
                            "not measurable", "", "0 photos", "Every one of the 19 shows a wall that is in training."))
    return rows


# ---------------------------------------------------------------- hold type

def hold_type():
    t = read("results_type.json")
    if t is None:
        return [missing("Hold type: the top guess is right", "results_type.json")]
    n = f"{count(t.get('test_holds'))} holds"
    base = f"{pct(t.get('always_guess_most_common'))} by always guessing the most common type"
    rows = [
        row("Hold type (big easy grip, thin edge, ...): the top guess is right", pct(t.get("top1")), base, n,
            "Gym photos with no copy in training. From one public dataset, not our own gym."),
        row("The right type is among the top three guesses (what the user picks from)", pct(t.get("top3")), "", n),
    ]
    if t.get("confident_share") is not None:
        rows.append(row("Holds the app is confident about, so it does not ask the user to check",
                        f"{pct(t['confident_share'])} of holds; {pct(t.get('confident_top1'))} of those are right",
                        "", n, "The rest are flagged for the user to confirm."))
    per = t.get("per_class_top1") or {}
    if per:
        words = sorted(((TYPE_WORDS.get(k.lower(), k.lower()), v) for k, v in per.items()), key=lambda kv: kv[1])
        rows.append(row("Top guess right, by type, weakest first", "; ".join(f"{w} {pct(v)}" for w, v in words), "", n,
                        "There is no \"foot only\" type in the training data; the app guesses it from size and "
                        "always flags it."))
    return rows


# ---------------------------------------------------------------- seeing routes

def seeing_routes():
    what = "One click on a hold selects its whole route"
    r = read("results_routes.json")
    if r is None:
        return [missing(what, "results_routes.json")]
    table, data = r.get("rows") or [], r.get("data") or {}
    good = r.get("good_match_is_f1_at_least", 0.8)
    n_routes = f"{count(data.get('routes'))} routes in {count(data.get('photos'))} photos"
    n_holds = f"{count(data.get('holds_with_a_route'))} holds in {count(data.get('photos'))} photos"
    today = pick(table, method="today (", setting="boxes")
    new = pick(table, method="new (routes.py)", setting="boxes", settings_chosen="leave-one-out")
    outl = pick(table, method="new (routes.py)", setting="outlines", settings_chosen="leave-one-out")
    shaken = pick(table, method="new (routes.py), boxes shaken", setting="boxes")
    shaken_today = pick(table, method="today, boxes shaken", setting="boxes")
    if not new or not today:
        return [row(what, "see the file", "", n_routes, "`results_routes.json` has a layout this script does not know.")]
    small = (f"Small test. A route counts when the selected group matches it well (F1 of {good} or more). The holds "
             "given are the hand-labelled ones, not the hold finder's output. Settings were chosen on seven photos "
             "and scored on the eighth, in turn.")
    rows = [
        row("Routes the app sees as one group, well enough that one click selects the route (holds known as boxes)",
            pct(new.get("routes_found")),
            f"{pct(today.get('routes_found'))} for the old rule (holds of a similar colour)", n_routes, small),
        row("Holds where a click selects that hold's own route", pct(new.get("holds_right")),
            f"{pct(today.get('holds_right'))} old rule", n_holds, "Stricter: every hold counts once."),
        row("Of the holds in a selected group, the share that belong to the route / of the route's holds, the share selected",
            f"{pct(new.get('precision'))} / {pct(new.get('recall'))}",
            f"{pct(today.get('precision'))} / {pct(today.get('recall'))} old rule", n_routes,
            "Averaged over routes, best-matching group for each."),
    ]
    if outl:
        rows.append(row("Routes seen as one group when each hold's exact outline is known, not only its box",
                        pct(outl.get("routes_found")), f"{pct(today.get('routes_found'))} old rule", n_routes,
                        "Uses hand-drawn outlines; the app's own outlines are rougher."))
    if shaken:
        rows.append(row("Routes seen as one group when the boxes are moved at random by up to 15%, to imitate the hold finder",
                        pct(shaken.get("routes_found")),
                        f"{pct(shaken_today.get('routes_found'))} old rule" if shaken_today else "", n_routes,
                        "Settings as shipped, chosen with these photos in view, so slightly flattering."))
    return rows


# ---------------------------------------------------------------- grading

def grading():
    rows = []
    board = ("On a training board (a standard wall with a fixed grid of holds, graded by thousands of users), "
             "not on gym walls.")
    g, kil, moon, noq = (read(f) for f in ("results_grade_model.json", "results_kilter.json", "results.json",
                                           "results_no_hold_quality.json"))
    k_base = pick((kil or {}).get("results"), model="always guess the median")
    m_base = pick((moon or {}).get("results"), model="always guess the median")
    k_n = f"{count((kil or {}).get('n_test'))} test rows" if kil else "20% of the climbs"
    m_n = f"{count((moon or {}).get('n_test'))} test climbs" if moon else "20% of the climbs"

    if g is None:
        rows.append(missing("How far off the app's grade is, Kilter board", "results_grade_model.json"))
    else:
        res = g.get("results")
        chosen = g.get("chosen", "kilter + moonboard")
        k = pick(res, model=f"trained on {chosen}, tested on kilter")
        m = pick(res, model=f"trained on {chosen}, tested on moonboard")
        easy = pick(res, model=f"trained on {chosen}, tested on kilter below")
        rows.append(row("How far off the app's grade is on average, Kilter board, in grade steps (6a to 6a+ is one step)",
                        f"{num(k.get('mae'))} steps",
                        f"{num(k_base.get('mae'))} steps by always guessing the middle grade", k_n,
                        board + " Climbs held out from training."))
        rows.append(row("Grade within one step of the true grade, Kilter board", pct(k.get("within1")),
                        f"{pct(k_base.get('within1'))} always guessing the middle grade", k_n,
                        f"Exactly right: {pct(k.get('exact'))}."))
        if easy:
            n_easy = easy["model"].split("(n=")[-1].rstrip(")") if "(n=" in easy.get("model", "") else ""
            rows.append(row("The same on easier climbs only (below 6b), Kilter board",
                            f"{num(easy.get('mae'))} steps; {pct(easy.get('within1'))} within one step", "",
                            f"{int(n_easy):,} test rows" if n_easy.isdigit() else "",
                            "Most gym climbers are in this range; the error is about the same."))
        rows.append(row("How far off the app's grade is on average, MoonBoard, in grade steps",
                        f"{num(m.get('mae'))} steps",
                        f"{num(m_base.get('mae'))} steps by always guessing the middle grade", m_n,
                        board + " This board only has hard climbs (6b+ and up)."))
        rows.append(row("Grade within one step of the true grade, MoonBoard", pct(m.get("within1")),
                        f"{pct(m_base.get('within1'))} always guessing the middle grade", m_n,
                        f"Exactly right: {pct(m.get('exact'))}."))

    if kil is None:
        rows.append(missing("Does working out the moves help? Kilter board", "results_kilter.json"))
    else:
        res = kil.get("results")
        solver = pick(res, model="solver features, learned hold quality")
        raw = pick(res, model="raw holds + angle")
        geo = pick(res, model="solver features, geometry only")
        rows.append(row("Does working out the moves help? Grade error from the solved move sequence, Kilter board",
                        f"{num(solver.get('mae'))} steps",
                        f"{num(raw.get('mae'))} from the list of holds alone; {num(geo.get('mae'))} from distances "
                        f"alone, ignoring how good each hold is", k_n, board))
    if moon is None:
        rows.append(missing("Does working out the moves help? MoonBoard", "results.json"))
    else:
        res = moon.get("results")
        solver = pick(res, model="solver features only")
        raw = pick(res, model="raw holds only")
        without = pick((noq or {}).get("results"), model="solver features only")
        against = f"{num(raw.get('mae'))} from the list of holds alone"
        if without:
            against += f"; {num(without.get('mae'))} when the solver is not told how good each hold is"
        rows.append(row("The same on MoonBoard", f"{num(solver.get('mae'))} steps", against, m_n,
                        "Here the plain list of holds does slightly better: this board never changes, so a model "
                        "can memorise its holds. That does not carry over to a gym wall; the move sequence does."))
    rows.append(row("How far off the grade is on real gym routes", MISSING, "", "0 routes",
                    "No gym route with a known grade has been scored. The numbers above are for training boards."))
    return rows


# ---------------------------------------------------------------- output

GROUPS = [("Finding holds", finding_holds), ("Hold type", hold_type),
          ("Seeing routes", seeing_routes), ("How hard (grade)", grading)]


def cell(text):
    return str(text).replace("|", "/").replace("\n", " ")


def render():
    lines = ["# Benchmarks", "",
             "Every accuracy number the project has. Written by `benchmarks.py` from the `results_*.json` files; "
             "do not edit by hand, run `.venv/bin/python benchmarks.py` again.", "",
             "Words: a *hold* is a grip bolted to the wall. A *route* is the set of holds one climb uses, usually "
             "all one colour. The *grade* says how hard a climb is (4a easiest here, 6a, 6a+, 6b ... harder; each "
             "is one step). A *training board* (Kilter, MoonBoard) is a standard wall with a fixed grid of holds "
             "that thousands of people climb and grade through an app.", ""]
    for title, build in GROUPS:
        lines += [f"## {title}", "",
                  "| What is measured | Result | Compared against | Rests on | Caveat |",
                  "|---|---|---|---|---|"]
        try:
            rows = build()
        except Exception as e:                       # a results file with an unexpected layout must not stop the rest
            rows = [row(title, "could not be read", "", "", f"{type(e).__name__}: {e}")]
        for r in rows:
            lines.append("| " + " | ".join(cell(r[k]) for k in ("what", "result", "against", "examples", "caveat")) + " |")
        lines.append("")

    gym = read("results_gym_holds.json") or {}
    notes = [gym.get("independence_note"), (gym.get("climbinst_test_overlap") or {}).get("note"), gym.get("labels_note")]
    if any(notes):
        lines += ["## Is the gym-photo test independent?", ""] + [n for n in notes if n] + [""]
        if gym.get("per_photo"):
            lines += ["| Photo | Holds labelled | Found | Marks that are real holds | In training? |", "|---|---|---|---|---|"]
            for p in gym["per_photo"]:
                o = p.get("overlap") or {}
                if not o:
                    where = "not checked"
                else:
                    where = "same wall as training photo" if o.get("wall_in_training") else "wall not in training; closest"
                    where += f" {o.get('train', {}).get('closest_wall')} ({o.get('train', {}).get('matched_details')} matched details)"
                    if o.get("copy_of_a_photo_in"):
                        where = f"this photo is in the {o['copy_of_a_photo_in']} set; " + where
                lines.append(f"| {cell(p.get('photo', '').replace('images/', ''))} | {count(p.get('holds'))} | "
                             f"{pct(p.get('found'))} | {pct(p.get('predictions_real'))} | {cell(where)} |")
            lines.append("")

    lines += ["## Not measured", "",
              "- Grade error on real gym routes: there is no gym route with a known grade in the data.",
              "- Hold finding on hand-labelled photos of a gym the finder has never seen. The ClimbInst test photos "
              "are the nearest thing.",
              "- Route grouping on the hold finder's own output (the route test uses hand-labelled holds).",
              "- Whether the solved move sequence is the one climbers really use: there is no record of real "
              "sequences to compare with.",
              "- The \"foot only\" hold type: the type data has no such label."]
    absent = [f for f in KNOWN if read(f) is None]
    if absent:
        lines.append("- Result files not present when this was written: " + ", ".join(f"`{f}`" for f in absent) + ".")
    other = sorted(os.path.basename(f) for f in glob.glob(os.path.join(HERE, "results*.json"))
                   if os.path.basename(f) not in KNOWN)
    if other:
        lines.append("- Result files this script does not read yet: " + ", ".join(f"`{f}`" for f in other) + ".")
    return "\n".join(lines) + "\n"


def main():
    text = render()
    with open(os.path.join(HERE, "BENCHMARKS.md"), "w") as f:
        f.write(text)
    print(text)


if __name__ == "__main__":
    main()
