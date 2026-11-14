"""Checks for the physics engine and the foot moves (physics.py, limbs.py, pose.py, route.py).

Run:  .venv/bin/python test_physics.py          (from backend/, about half a minute)

Plain asserts, no test framework. It loads the grade model (LightGBM) through
route.solve, so it must not be run in a process that also uses PyTorch.
"""
import json
import math
import os
import random
import time

import limbs
import physics
import pose
import route

HERE = os.path.dirname(os.path.abspath(__file__))
CONTRACT = os.path.join(HERE, "..", "contract")
load = lambda name: json.load(open(os.path.join(CONTRACT, name)))
JOINTS = ("head", "hip", "lh", "rh", "l_elbow", "r_elbow", "lf", "rf", "l_knee", "r_knee")
LIMBS = ("LH", "RH", "LF", "RF")
is_number = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def check_response(req, out, hands_only):
    """Everything that must be true of a "limbs": "all" answer. hands_only is the answer to
    the same request with "limbs": "hands"."""
    holds = {h["id"]: h for h in req["holds"]}
    moves, frames = out["moves"], out["keyframes"]
    height_px = req["climber_height_m"] / (req["wall_height_m"] / req["image"]["h"])

    # One more keyframe than moves, numbered in order, ten joints of two whole numbers each.
    assert len(frames) == len(moves) + 1
    for k, frame in enumerate(frames):
        assert frame["move"] == k
        assert set(frame["joints"]) == set(JOINTS)
        for name in JOINTS:
            xy = frame["joints"][name]
            assert len(xy) == 2 and all(type(v) is int for v in xy), (name, xy)

    # Moves.
    for i, m in enumerate(moves):
        assert m["i"] == i and m["limb"] in LIMBS
        assert m["hold"] in holds or (m["hold"] is None and m["limb"][1] == "F")
        assert is_number(m["load"]) and 0 <= m["load"] <= 1 and is_number(m["span_m"]) and m["span_m"] >= 0
        assert is_number(m["effort"]) and m["effort"] >= 0 and type(m["stable"]) is bool
        assert not m["stable"] or m["effort"] < 1

    # The hand moves, the hardest move and the grade are the hands-only answer, untouched.
    # The grade is the hands-only answer's; the moves shown are the safest sequence, which
    # ends with both hands on the finish and says how likely each move is to end in a fall.
    assert out["grade"] == hands_only["grade"]
    last = frames[-1]["contacts"]
    assert last["LH"] in req["finish"] and last["RH"] in req["finish"], last
    if "finish_chance" in out["physics"]:
        assert all(0 <= m["fall_chance"] <= 1 for m in moves)
        assert abs(out["physics"]["finish_chance"] - math.prod(1 - m["fall_chance"] for m in moves)) < 0.01
        if moves:
            assert moves[out["crux"]]["limb"][1] == "H"

    for k, frame in enumerate(frames):
        contacts, joints = frame["contacts"], frame["joints"]
        assert set(contacts) == set(LIMBS)
        assert contacts["LH"] in holds and contacts["RH"] in holds
        feet = [contacts[f] for f in ("LF", "RF") if contacts[f] is not None]
        assert all(f in holds for f in feet)
        assert len(set(feet)) == len(feet), "two feet on one hold"
        assert not set(feet) & {contacts["LH"], contacts["RH"]}, "a foot on a hold a hand is on"

        # Each move changes one limb's contact, and it is the limb the move names.
        if k:
            before, m = frames[k - 1]["contacts"], moves[k - 1]
            assert [limb for limb in LIMBS if before[limb] != contacts[limb]] == [m["limb"]], (before, contacts, m)
            assert contacts[m["limb"]] == m["hold"]

        # Hands and feet are drawn on the holds they are said to be on.
        for limb in LIMBS:
            if contacts[limb] is None:
                continue
            h, (x, y) = holds[contacts[limb]], joints[limb.lower()]
            side = 0.0
            if limb[1] == "H" and contacts["LH"] == contacts["RH"]:   # two hands sit side by side on one hold
                side = min(h.get("w", 0) / 4, 0.04 * height_px)
            assert abs(x - h["x"]) <= side + 1 and abs(y - h["y"]) <= 1, (limb, (x, y), h)

        # Reach: no hand further than an arm from the neck, no foot further than a leg from the hip.
        head, hip = joints["head"], joints["hip"]
        neck = [head[i] + pose.NECK_FRACTION * (hip[i] - head[i]) for i in (0, 1)]
        for hand in ("lh", "rh"):
            assert math.dist(neck, joints[hand]) <= pose.ARM * height_px + 3, (k, hand)
        for foot in ("lf", "rf"):
            assert math.dist(hip, joints[foot]) <= pose.LEG * height_px + 3, (k, foot)

        # Physics.
        ph = frame["physics"]
        assert len(ph["com"]) == 2 and all(is_number(v) for v in ph["com"])
        assert is_number(ph["effort"]) and ph["effort"] >= 0 and type(ph["stable"]) is bool
        assert not ph["stable"] or ph["effort"] < 1
        assert [f["limb"] for f in ph["forces"]] == list(LIMBS)
        for f in ph["forces"]:
            assert f["at"] == joints[f["limb"].lower()]
            assert len(f["f"]) == 2 and all(is_number(v) for v in f["f"]) and 0 <= f["share"] <= 1
        assert abs(sum(f["share"] for f in ph["forces"]) - 1) < 0.01
        if ph["stable"]:      # the forces hold up exactly one body-weight and do not push sideways
            assert abs(sum(f["f"][0] for f in ph["forces"])) < 0.01, ph
            assert abs(sum(f["f"][1] for f in ph["forces"]) + 1) < 0.01, ph

    top = out["physics"]
    assert top["model"] == "static-2.5d"
    if moves:
        assert top["max_effort"] == max(m["effort"] for m in moves)
        assert abs(top["mean_effort"] - sum(m["effort"] for m in moves) / len(moves)) < 0.001
    assert top["unstable_positions"] == sum(1 for m in moves if not m["stable"])


def test_hands_mode_is_unchanged():
    req, want = load("solve_request.json"), load("solve.json")
    got = route.solve(dict(req, limbs="hands"))
    assert got == want
    assert json.dumps(got) == json.dumps(want), "same values but a different order or number type"
    print('ok  "limbs": "hands" reproduces contract/solve.json exactly')
    return got


def test_contract_route(hands_only):
    req = load("solve_request.json")
    out = route.solve(req)                                   # no "limbs" field means "all"
    assert out == route.solve(dict(req, limbs="all"))
    json.dumps(out)
    check_response(req, out, hands_only)
    feet = [m for m in out["moves"] if m["limb"][1] == "F"]
    print(f'ok  contract route with all limbs: {len(out["moves"])} moves ({len(feet)} foot moves), '
          f'{len(out["keyframes"])} keyframes, grade {out["grade"]["font"]}, physics {out["physics"]}')
    try:
        route.solve(dict(req, limbs="feet"))
        raise AssertionError("an unknown limbs value was accepted")
    except route.RouteError:
        pass


def test_statics():
    jug = ("jug", 0.9)
    hands = [("LH", -1.0, 10.0, *jug), ("RH", 1.0, 10.0, *jug)]
    feet = [("LF", -1.0, 3.0, "hold"), ("RF", 1.0, 3.0, "hold")]

    # Hanging from two big easy grips with good footholds below: easy.
    easy = physics.solve(hands, feet, 5.5, 0.0)
    assert easy.stable and easy.effort < 0.25, easy.effort
    # The same hands on a 30 degree overhang with no feet: clearly harder.
    hang = physics.solve(hands, [], 5.5, 0.0, angle_deg=30)
    assert hang.effort > 3 * easy.effort and hang.effort > easy.effort + 0.3, (easy.effort, hang.effort)
    # The same position gets harder as the wall tips back, with feet and without.
    for ft in (feet, []):
        e = [physics.solve(hands, ft, 5.5, 0.0, angle_deg=a).effort for a in (0, 15, 30, 45)]
        assert e == sorted(e) and e[-1] > e[0], e
    # Feet on the bare wall help a little on a vertical wall and not at all on an overhang.
    wall = [("LF", -1.0, 3.0, "wall"), ("RF", 1.0, 3.0, "wall")]
    on_wall = physics.solve(hands, wall, 5.5, 0.0)
    assert 0 < sum(on_wall.forces[f][1] for f in ("LF", "RF")) < 0.3
    assert all(physics.solve(hands, wall, 5.5, 0.0, angle_deg=30).forces[f][:2] == (0.0, 0.0) for f in ("LF", "RF"))
    # Worse holds, same position: more effort. Two rounded holds on a 30 degree overhang cannot be held.
    crimps = [("LH", -1.0, 10.0, "crimp", 0.4), ("RH", 1.0, 10.0, "crimp", 0.4)]
    assert physics.solve(crimps, [], 5.5, 0.0).effort > physics.solve(hands, [], 5.5, 0.0).effort
    slopers = [("LH", -1.0, 10.0, "sloper", 0.3), ("RH", 1.0, 10.0, "sloper", 0.3)]
    assert not physics.solve(slopers, [], 5.5, 0.0, angle_deg=30).stable
    # One hand on a thin edge, nothing else: cannot be held. A body far out to the side of every hold neither.
    assert not physics.solve(crimps[:1], [], 5.5, -1.0).stable
    assert not physics.solve(crimps, feet, 5.5, 9.0).stable
    # Letting the climber shift their weight never makes it harder than a fixed place inside that range.
    one = [("LH", -1.0, 10.0, "crimp", 0.4)]
    far_foot = [("RF", 3.0, 3.0, "hold")]
    assert physics.solve(one, far_foot, 5.5, -2.0, 3.0).effort <= physics.solve(one, far_foot, 5.5, 0.0).effort + 1e-6

    # Random positions: whenever the forces balance they add up to the body's weight exactly.
    rng = random.Random(1)
    kinds = sorted(physics.HAND)
    balanced = n = 0
    start = time.perf_counter()
    for _ in range(3000):
        hs = [(limb, rng.uniform(-4, 4), rng.uniform(7, 12), rng.choice(kinds), rng.random())
              for limb in rng.sample(["LH", "RH"], rng.choice([1, 2]))]
        fs = [(limb, rng.uniform(-4, 4), rng.uniform(0, 5), rng.choice(["hold", "hold", "wall", "floor"]))
              for limb in rng.sample(["LF", "RF"], rng.choice([0, 1, 2, 2]))]
        angle = rng.uniform(-20, 70)
        r = physics.solve(hs, fs, rng.uniform(4, 7), rng.uniform(-3, 0), rng.uniform(0, 3), angle_deg=angle)
        n += 1
        assert r.effort >= 0 and (not r.stable or r.effort < 1) and (r.balanced or r.effort >= 1)
        if r.balanced:
            balanced += 1
            c = math.cos(math.radians(angle))
            assert abs(sum(f[0] for f in r.forces.values())) < 1e-3              # along the wall, sideways
            assert abs(sum(f[1] for f in r.forces.values()) - c) < 1e-3          # along the wall, upward
            photo = r.photo_forces()
            assert abs(sum(f[0] for f in photo.values())) < 1e-3                 # as seen in the photo
            assert abs(sum(f[1] for f in photo.values()) + 1) < 1e-3, (photo, angle)
            assert abs(sum(f[2] for f in photo.values()) - 1) < 1e-6
    per = (time.perf_counter() - start) / n
    assert per < 1e-3, f"{per * 1e6:.0f} microseconds a position"
    print(f"ok  statics: easy {easy.effort:.2f}, free hang on a 30 degree overhang {hang.effort:.2f}; "
          f"{balanced} of {n} random positions balance and all of those add up; "
          f"{per * 1e6:.0f} microseconds a position")


def test_shorter_is_never_easier():
    """Identical holds, climbers from 2.0 m down to 1.5 m. The holds are far enough apart that
    nobody is cramped, so going shorter means going toward full stretch and then out of reach."""
    rng = random.Random(5)
    heights = [2.0, 1.9, 1.8, 1.7, 1.6, 1.5]
    compared = out_of_reach = 0
    for n in range(400):
        kind = rng.choice([("jug", 0.9), ("crimp", 0.4), ("sloper", 0.3), ("pinch", 0.55)])
        foot_y = rng.uniform(0.1, 0.4), rng.uniform(0.1, 0.4)
        hand_y = [max(foot_y) + rng.uniform(1.8, 2.3) for _ in (0, 1)]
        if n == 0:                                            # one plain, symmetric case
            kind, foot_y, hand_y = ("jug", 0.9), (0.2, 0.2), [2.2, 2.2]
        hands = [(rng.uniform(-0.5, 0), hand_y[0], *kind), (rng.uniform(0, 0.5), hand_y[1], *kind)]
        feet = [(rng.uniform(-0.5, 0), foot_y[0]), (rng.uniform(0, 0.5), foot_y[1])]
        angle = rng.choice([0, 10, 25, 45])
        efforts = []
        for h in heights:
            r = limbs.hold_position(hands, feet, angle, h)
            efforts.append(math.inf if r is None else r.effort)    # cannot reach: cannot hold it at all
        if efforts[0] == math.inf:                                # too far apart even for the tallest: nothing to compare
            continue
        for taller, shorter in zip(efforts, efforts[1:]):
            assert shorter >= taller - 1e-6, (hands, feet, angle, efforts)
            compared += taller < math.inf
            out_of_reach += taller < math.inf and shorter == math.inf
    print(f"ok  shorter is never easier: {compared} taller/shorter pairs on 400 stretched positions, "
          f"{out_of_reach} of them out of reach for the shorter climber")


def random_request(rng, analysis):
    holds = analysis["holds"]
    seed = rng.choice(holds)
    route_holds = sorted(holds, key=lambda h: abs(h["x"] - seed["x"]) + rng.uniform(0, 400))[:rng.randint(3, 16)]
    route_holds = [dict(h) for h in sorted(route_holds, key=lambda h: -h["y"])]
    for h in route_holds[1:-1]:
        if rng.random() < 0.15:                               # some foot-only holds
            h["type"], h["quality"] = "foot", 0.1
    return {"image": analysis["image"], "holds": route_holds,
            "start": [h["id"] for h in route_holds[:rng.choice([1, 2])]], "finish": [route_holds[-1]["id"]],
            "climber_height_m": rng.uniform(1.5, 2.0), "wall_height_m": rng.uniform(3, 6),
            "wall_angle_deg": rng.uniform(0, 45)}


def test_random_requests(n=1000):
    rng = random.Random(0)
    analysis = load("analyze.json")
    solved = no_route = foot_moves = moves = unstable = 0
    slowest = 0.0
    for _ in range(n):
        req = random_request(rng, analysis)
        try:
            hands_only = route.solve(dict(req, limbs="hands"))
        except route.RouteError:
            # No hand sequence (a move is out of reach). Both kinds of answer must say so.
            try:
                route.solve(req)
                raise AssertionError("all-limbs mode answered where hands mode found no sequence")
            except route.RouteError:
                no_route += 1
            continue
        start = time.perf_counter()
        out = route.solve(req)
        slowest = max(slowest, time.perf_counter() - start)
        json.dumps(out)
        check_response(req, out, hands_only)
        solved += 1
        moves += len(out["moves"])
        foot_moves += sum(1 for m in out["moves"] if m["limb"][1] == "F")
        unstable += out["physics"]["unstable_positions"]
    assert solved > n // 2
    print(f"ok  {n} random requests: {solved} solved and passed every check, {no_route} had no hand sequence; "
          f"{moves} moves, {foot_moves} of them foot moves, {unstable} cannot be held still; "
          f"slowest answer {slowest * 1000:.0f} ms")


def test_long_route_is_fast():
    analysis = load("analyze.json")
    band = sorted((h for h in analysis["holds"] if 200 <= h["x"] < 500), key=lambda h: -h["y"])
    req = {"image": analysis["image"], "holds": band, "start": [band[0]["id"]], "finish": [band[-1]["id"]],
           "climber_height_m": 1.5, "wall_height_m": 6.0, "wall_angle_deg": 10}
    best_all = best_hands = math.inf
    for _ in range(5):
        start = time.perf_counter()
        out = route.solve(req)
        best_all = min(best_all, time.perf_counter() - start)
        start = time.perf_counter()
        hands_only = route.solve(dict(req, limbs="hands"))
        best_hands = min(best_hands, time.perf_counter() - start)
    assert len(out["moves"]) >= 15, len(out["moves"])
    check_response(req, out, hands_only)
    assert best_all < 1.0, best_all     # the safest-route search costs most of this; realism over speed
    print(f'ok  {len(out["moves"])}-move route on {len(band)} holds: {best_all * 1000:.0f} ms with all limbs, '
          f'{best_hands * 1000:.0f} ms hands only (the hand search and the grade are in both)')


def test_physics_features():
    req = load("solve_request.json")
    image_h = req["image"]["h"]
    scale = req["wall_height_m"] / image_h / route.UNIT_M
    hand = [h for h in req["holds"] if h["type"] != "foot"]
    pts = [(h["x"] * scale, (image_h - h["y"]) * scale) for h in hand]
    foot = [(h["x"] * scale, (image_h - h["y"]) * scale) for h in req["holds"] if h["type"] == "foot"]
    bad = {p: 1 - h["quality"] for p, h in zip(pts, hand)}
    ids = [h["id"] for h in hand]
    start, finish = [ids.index(i) for i in req["start"]], [ids.index(i) for i in req["finish"]]
    clock = time.perf_counter()
    f = route.physics_features(pts, start, finish, bad, angle_deg=40, foot_holds=foot)
    took = time.perf_counter() - clock
    assert tuple(f) == limbs.FEATURES and all(is_number(v) for v in f.values()) and f["phys_solved"] == 1
    vertical = route.physics_features(pts, start, finish, bad, angle_deg=0, foot_holds=foot)
    assert f["phys_effort_max"] > vertical["phys_effort_max"], "a 40 degree board should be harder than a vertical one"
    # Out of reach: same keys, every value -1 except phys_solved 0.
    none = route.physics_features([(0.0, 0.0), (0.0, 30.0)], [0], [1], {})
    assert tuple(none) == limbs.FEATURES and none["phys_solved"] == 0 and set(list(none.values())[1:]) == {-1.0}
    print(f"ok  physics_features: {len(f)} numbers in {took * 1000:.1f} ms; highest effort "
          f"{vertical['phys_effort_max']:.2f} vertical, {f['phys_effort_max']:.2f} at 40 degrees")


if __name__ == "__main__":
    began = time.perf_counter()
    route.warm()
    hands_only = test_hands_mode_is_unchanged()
    test_contract_route(hands_only)
    test_statics()
    test_shorter_is_never_easier()
    test_physics_features()
    test_long_route_is_fast()
    test_random_requests()
    print(f"all passed in {time.perf_counter() - began:.0f} s")
