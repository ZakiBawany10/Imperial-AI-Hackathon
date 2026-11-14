"""Add the feet to a hands-only sequence.

beta_solver.solve() decides where the hands go and in what order. This module
keeps that exactly as it is and decides, for each hand position, which holds
the feet stand on, using the statics model in physics.py to compare choices.

Units: the solver's grid units, y UP. The climber is always HEIGHT units tall
(route.py scales the wall, not the climber, so a shorter person sees a bigger
wall).

How the feet are chosen

- "Hand position k" is where the hands are after k hand moves (0 = the start).
- For hand move k the feet are set first, while the hands are still in
  position k-1, and stay put while the hand moves. So that pair of footholds
  has to be reachable from both hand positions.
- For each hand move, up to TOP_FEET footholds are tried (the ones nearest
  below the hand that stays on), one foot or two, plus "both feet on the bare
  wall", which is always possible.
- The cost of a choice is the effort of the hand move with those feet: the
  effort of the three limbs left on the wall, with the climber's weight shifted
  to the best place from which the moving hand still reaches its new hold.
- One pass over the whole climb picks the cheapest chain of choices, where
  every foot change costs SWITCH extra (so a foot stays where it is unless
  moving it saves at least that much effort), and effort above 1 costs extra.
- Each foot change becomes its own move, just before the hand move it is for.

A foot that is "on the bare wall" follows the body: below the hip, to its own
side. If that reaches the floor it is standing on the floor.
"""
import math

import physics
import pose

HEIGHT = 8.75            # the climber's height in solver units (1.75 m at 0.2 m a unit)
BODY_OUT = physics.BODY_OUT_M / 0.2   # centre of mass to wall, solver units, for the 1.75 m climber
TOP_FEET = 4             # footholds tried for each hand move
SWITCH = 0.05            # effort a foot move must save to be worth making
OVER_1 = 2.0             # extra cost per unit of effort above 1 (a position that cannot be held)
MATCH_OFFSET = 0.04      # two hands on one hold sit this share of height either side of its centre

_SIDE = {"LF": -1, "RF": 1}


class _Planner:
    def __init__(self, pts, states, kinds, q_left, q_right, widths, angle_deg, height, body_out, floor):
        n = len(pts)
        self.pts = [(float(x), float(y)) for x, y in pts]
        self.states = [tuple(s) for s in states]
        self.kinds = list(kinds) if kinds is not None else ["unknown"] * n
        self.q_left = list(q_left) if q_left is not None else [0.5] * n
        self.q_right = list(q_right) if q_right is not None else self.q_left
        self.widths = list(widths) if widths is not None else [0.0] * n
        self.angle, self.height, self.body_out, self.floor = float(angle_deg), height, body_out, floor
        # On an overhang every bit of height the body gives up makes the hands' job easier, so the
        # climber hangs on dead-straight arms; otherwise slightly bent (pose.HANG), which looks natural.
        self.hang = 1.0 if self.angle > 0 else pose.HANG
        self.hand_pts = [self._hand_points(s) for s in self.states]
        self.mover = [None] + ["LH" if a[0] != b[0] else "RH" for a, b in zip(self.states, self.states[1:])]
        self.top = [self._top_feet(k) for k in range(len(self.states))]
        self._range = [None] * len(self.states)     # per hand position: {sorted footholds: (x_lo, x_hi) or None}
        self._floor = [floor] * len(self.states)    # the floor rule in force for that hand position
        self._setups, self._results = {}, {}

    # ---- geometry ----

    def _hand_points(self, state):
        (lx, ly), (rx, ry) = self.pts[state[0]], self.pts[state[1]]
        if state[0] == state[1]:                    # both hands share a hold: side by side
            off = min(self.widths[state[0]] / 4, MATCH_OFFSET * self.height)
            return (lx - off, ly), (rx + off, ry)
        return (lx, ly), (rx, ry)

    def _top_feet(self, k):
        """Footholds worth trying for hand move k (for k = 0, the start position): holds no
        hand is on before or after the move, low enough to stand on, nearest below the hand
        that stays on."""
        h = self.height
        hands = list(self.hand_pts[k])
        taken = set(self.states[k])
        if k:
            hands += self.hand_pts[k - 1]
            taken |= set(self.states[k - 1])
            stay = self.hand_pts[k][1 if self.mover[k] == "LH" else 0]
        else:
            stay = ((hands[0][0] + hands[1][0]) / 2, (hands[0][1] + hands[1][1]) / 2)
        reach = (pose.ARM + pose.FOOT_REACH * pose.LEG) * h
        # the hip has to fit between "above the foot" and "under the hands"
        top_y = min(max(a[1], b[1]) for a, b in ([self.hand_pts[k]] + ([self.hand_pts[k - 1]] if k else [])))
        max_y = top_y + (pose.NECK_OVER_HANDS - pose.TORSO - pose.FOOT_BELOW_HIP) * h
        scored = []
        for j, (x, y) in enumerate(self.pts):
            if j in taken or y > max_y:
                continue
            if any(math.hypot(x - hx, y + pose.TORSO * h - hy) > reach for hx, hy in hands):
                continue
            scored.append((abs(x - stay[0]) - 0.5 * min(stay[1] - y, 1.1 * h), j))
        scored.sort()
        return [j for _, j in scored[:TOP_FEET]]

    def _ranges(self, k):
        """Body x range for every foot placement that may be asked about at hand position k."""
        if self._range[k] is None:
            holds = set(self.top[k]) | (set(self.top[k + 1]) if k + 1 < len(self.states) else set())
            holds = sorted(holds - set(self.states[k]))
            keys = [()] + [(j,) for j in holds] + [(a, b) for i, a in enumerate(holds) for b in holds[i + 1:]]
            sets = [tuple(self.pts[j] for j in key) for key in keys]
            out = pose.body_x_ranges(self.hand_pts[k], sets, self.height, self._floor[k])
            if out[0] is None and self._floor[k] is not None:
                # Hands too low and wide to keep the hip off the floor: drop that rule here.
                self._floor[k] = None
                out = pose.body_x_ranges(self.hand_pts[k], sets, self.height, None)
            if out[0] is None:                      # hands at the very limit of the arms: stand between them
                mid = (self.hand_pts[k][0][0] + self.hand_pts[k][1][0]) / 2
                out[0] = (mid, mid)
            self._range[k] = dict(zip(keys, out))
        return self._range[k]

    @staticmethod
    def _key(feet):
        return tuple(sorted(j for j in feet if j is not None))

    def x_range(self, k, feet):
        """(x_lo, x_hi) for the neck with hands in position k and feet = (left, right) hold
        indices (None = bare wall), or None when the limbs cannot all reach."""
        if feet[0] is not None and feet[0] == feet[1]:
            return None
        if set(feet) & set(self.states[k]):
            return None
        ranges, key = self._ranges(k), self._key(feet)
        if key not in ranges:
            ranges[key] = pose.body_x_ranges(self.hand_pts[k], [tuple(self.pts[j] for j in key)],
                                             self.height, self._floor[k])[0]
        return ranges[key]

    # ---- physics ----

    def _contacts(self, k, feet, neck):
        """The limbs as physics.solve() wants them, for a body whose neck is at `neck`."""
        left, right = self.states[k]
        (lx, ly), (rx, ry) = self.hand_pts[k]
        hands = [("LH", lx, ly, self.kinds[left], self.q_left[left]),
                 ("RH", rx, ry, self.kinds[right], self.q_right[right])]
        out, on_floor = [], False
        for limb, j in (("LF", feet[0]), ("RF", feet[1])):
            if j is not None:
                out.append((limb, self.pts[j][0], self.pts[j][1], "hold"))
            else:
                (x, y), floor = pose.wall_foot(neck, _SIDE[limb], self.height, self.floor)
                on_floor = on_floor or floor
                out.append((limb, x, y, "floor" if floor else "wall"))
        # Standing on the floor: the ground carries the weight whatever the wall above does.
        angle = 0.0 if on_floor else self.angle
        return hands, out, angle, neck[1] - pose.COM_DOWN * pose.TORSO * self.height

    def foot_reaches(self, neck, j):
        """Can a foot stand on hold j with the neck where it is?"""
        h = self.height
        hip_y = neck[1] - pose.TORSO * h
        x, y = self.pts[j]
        return y <= hip_y - pose.FOOT_BELOW_HIP * h and math.hypot(x - neck[0], y - hip_y) <= pose.FOOT_REACH * pose.LEG * h

    def _foot_points(self, feet):
        return tuple(self.pts[j] for j in feet if j is not None)

    def _setup(self, k, feet):
        key = (k, feet)
        if key not in self._setups:
            x_lo, x_hi = self.x_range(k, feet)
            hp, fp = self.hand_pts[k], self._foot_points(feet)
            x_pref = min(max((hp[0][0] + hp[1][0]) / 2, x_lo), x_hi)       # under the hands when it makes no difference
            x_ref = min(max(sum(p[0] for p in fp) / len(fp), x_lo), x_hi) if fp else x_pref
            neck = (x_ref, pose.neck_height(x_ref, hp, fp, self.height, self._floor[k], self.hang))
            self._setups[key] = self._contacts(k, feet, neck) + (x_lo, x_hi, x_pref)
        return self._setups[key]

    def quick(self, k, feet, off=None):
        """Effort with hands in position k, feet as given and limb `off` in the air, with the
        weight shifted sideways to the best place. Feet on the bare wall are placed for a
        body near the middle, which is close enough for comparing choices."""
        key = (k, feet, off)
        if key not in self._results:
            hands, ft, angle, com_y, x_lo, x_hi, x_pref = self._setup(k, feet)
            if off:
                hands = [c for c in hands if c[0] != off]
                ft = [c for c in ft if c[0] != off]
            self._results[key] = physics.solve(hands, ft, com_y, x_lo, x_hi, angle, self.height, self.body_out, x_pref)
        return self._results[key]

    def exact(self, k, feet, off=None):
        """The same, but finished properly: take the body position quick() found, put the
        bare-wall feet where that body would have them, and work the forces out again there.
        Returns (neck, hands, feet, physics result)."""
        first = self.quick(k, feet, off)
        hp, fp = self.hand_pts[k], self._foot_points(feet)
        x_lo, x_hi = self.x_range(k, feet)
        x = min(max(first.com_x, x_lo), x_hi)
        neck = (x, pose.neck_height(x, hp, fp, self.height, self._floor[k], self.hang))
        hands, ft, angle, com_y = self._contacts(k, feet, neck)
        if off:
            hands = [c for c in hands if c[0] != off]
            ft_on = [c for c in ft if c[0] != off]
        else:
            ft_on = ft
        if self.angle == 0.0 and len(fp) == 2:
            result = first                           # vertical wall, both feet on holds: nothing depended on the body's height
        else:
            result = physics.solve(hands, ft_on, com_y, x, None, angle, self.height, self.body_out)
        return neck, hands, ft, result

    # ---- choosing the feet ----

    def candidates(self, k):
        """Foot placements (left, right) to consider for hand move k: reachable from the
        hand position before the move and the one after."""
        top = self.top[k]
        x = lambda j: self.pts[j][0]
        opts = [(None, None)]
        for j in top:
            opts += [(j, None), (None, j)]
        for i, a in enumerate(top):
            for b in top[i + 1:]:
                opts.append((a, b) if x(a) <= x(b) else (b, a))          # feet never cross
        ok = [f for f in opts if self.x_range(k, f) is not None and (k == 0 or self.x_range(k - 1, f) is not None)]
        return ok or [(None, None)]

    def choose(self):
        """The cheapest chain of foot placements, one per hand position."""
        price = lambda e: e + OVER_1 * max(0.0, e - 1.0)
        best = {f: (price(self.quick(0, f).effort), None) for f in self.candidates(0)}
        layers = [best]
        for k in range(1, len(self.states)):
            layer = {}
            for f in self.candidates(k):
                here = price(self.quick(k, f, self.mover[k]).effort)
                pick, pick_cost = None, math.inf
                for g, (cost, _) in layers[-1].items():
                    c = cost + SWITCH * ((g[0] != f[0]) + (g[1] != f[1]))
                    if c < pick_cost:
                        pick, pick_cost = g, c
                layer[f] = (pick_cost + here, pick)
            layers.append(layer)
        f = min(layers[-1], key=lambda g: layers[-1][g][0])
        chain = [f]
        for layer in reversed(layers[1:]):
            f = layer[f][1]
            chain.append(f)
        return chain[::-1]

    def foot_steps(self, k, old, new):
        """The one-foot-at-a-time steps that take the feet from `old` to `new` with the hands
        in position k. Returns [(limb, feet after that step)]. Every step is reachable."""
        left, right = old[0] != new[0], old[1] != new[1]
        if not left and not right:
            return []
        if left != right:
            return [("LF" if left else "RF", new)]
        for limb, mid in (("LF", (new[0], old[1])), ("RF", (old[0], new[1]))):
            if self.x_range(k, mid) is not None:
                return [(limb, mid), ("RF" if limb == "LF" else "LF", new)]
        # Neither order works directly (the feet would have to share a hold, or over-stretch):
        # put the left foot on the bare wall first. Dropping a foothold never costs reach.
        steps, at = [], old
        for limb, to, more in (("LF", (None, old[1]), old), ("RF", (None, new[1]), new), ("LF", new, new)):
            if to != at:
                if self.x_range(k, to) is None:      # sampling missed it: any body position that reaches `more` reaches `to`
                    self._ranges(k)[self._key(to)] = self.x_range(k, more)
                steps.append((limb, to))
                at = to
        return steps


def plan(pts, states, kinds=None, quality_left=None, quality_right=None, widths=None,
         angle_deg=0.0, height=HEIGHT, body_out=BODY_OUT, floor=None):
    """Add foot moves to a hand sequence.

    pts: [(x, y)] every hold on the route, hands' and feet's, solver units, y up.
    states: [(left-hand hold, right-hand hold)] as indices into pts: the start position,
        then the position after each hand move (consecutive entries differ in one hand).
    kinds: hold type of each hold (see physics.HAND); default "unknown".
    quality_left, quality_right: quality 0..1 of each hold for that hand; default 0.5.
    widths: width of each hold (only used to put two hands side by side on one hold).
    angle_deg: overhang of the wall. floor: height of the floor, or None when the wall has
        none (a training board).
    height: the climber's height, body_out: centre of mass to wall, both in solver units.

    Returns {"moves": [...], "frames": [...]}, one more frame than moves; frames[0] is the
    start and frames[i + 1] is the position after moves[i].
      move:  limb ("LH", "RH", "LF", "RF"), hold (index into pts, or None = bare wall),
             hand_move (which entry of the hand sequence this is, 0-based; None for a foot
             move), effort, stable, balanced, pull
      frame: contacts {limb: hold index or None}, on {foot: "hold" | "wall" | "floor"},
             points {limb: (x, y)}, neck (x, y), com (x, y), physics (a physics.Result),
             limbs (the hands and feet as physics.solve() takes them)
    """
    p = _Planner(pts, states, kinds, quality_left, quality_right, widths, angle_deg, height, body_out, floor)
    chain = p.choose()

    def frame(k, feet):
        neck, hands, ft, result = p.exact(k, feet)
        contacts = {"LH": p.states[k][0], "RH": p.states[k][1], "LF": feet[0], "RF": feet[1]}
        points = {c[0]: (c[1], c[2]) for c in hands + ft}
        return {"contacts": contacts, "on": {c[0]: c[3] for c in ft}, "points": points, "neck": neck,
                "com": pose.centre_of_mass(neck, height), "physics": result, "limbs": (hands, ft)}

    def move(limb, hold, hand_move, k, feet):
        r = p.exact(k, feet, limb)[3]
        before = frames[-1]
        if hand_move is None and (hold is None or p.foot_reaches(before["neck"], hold)):
            # The foot can get to its new place without the body moving first, so the climber
            # may simply lift it from where they stand. Count whichever is easier.
            hands, ft = before["limbs"]
            angle = 0.0 if "floor" in (c[3] for c in ft) else p.angle
            stand = physics.solve(hands, [c for c in ft if c[0] != limb], before["com"][1], before["com"][0], None,
                                  angle, height, body_out)
            if stand.effort < r.effort:
                r = stand
        return {"limb": limb, "hold": hold, "hand_move": hand_move, "effort": r.effort,
                "stable": r.stable, "balanced": r.balanced, "pull": r.pull}

    moves, frames = [], [frame(0, chain[0])]
    for k in range(1, len(p.states)):
        for limb, feet in p.foot_steps(k - 1, chain[k - 1], chain[k]):
            moves.append(move(limb, feet[0 if limb == "LF" else 1], None, k - 1, feet))
            frames.append(frame(k - 1, feet))
        limb = p.mover[k]
        moves.append(move(limb, p.states[k][0 if limb == "LH" else 1], k - 1, k, chain[k]))
        frames.append(frame(k, chain[k]))
    return {"moves": moves, "frames": frames}


def hold_position(hands, feet, angle_deg=0.0, height_m=1.75, off=None):
    """Effort of one position given in metres, for a climber of a given height.

    hands: [(x, y, hold type, quality)] left hand then right hand (give the same hold twice
    for both hands on one). feet: [(x, y)] the footholds for the left and right foot; use
    None for a foot on the bare wall. y up, no floor. off: a limb to leave out ("LH", ...).
    Returns the physics.Result, or None when this climber cannot reach all of those at once.
    """
    unit = 0.2 * height_m / 1.75
    pts = [(x / unit, y / unit) for x, y, _, _ in hands]
    kinds, quality = [h[2] for h in hands], [h[3] for h in hands]
    ft = []
    for f in feet:
        if f is None:
            ft.append(None)
        else:
            ft.append(len(pts))
            pts.append((f[0] / unit, f[1] / unit))
            kinds.append("foot")
            quality.append(0.1)
    p = _Planner(pts, [(0, 1)], kinds, quality, quality, None, angle_deg, HEIGHT,
                 physics.BODY_OUT_M / unit, None)
    p.top[0] = [j for j in ft if j is not None]
    ft = tuple(ft)
    if p.x_range(0, ft) is None:
        return None
    return p.exact(0, ft, off)[3]


FEATURES = ("phys_solved", "phys_moves", "phys_foot_moves", "phys_effort_max", "phys_effort_mean",
            "phys_effort_top2", "phys_hand_effort_max", "phys_hand_effort_mean", "phys_unstable",
            "phys_unbalanced", "phys_rest_effort_max", "phys_rest_effort_mean", "phys_hand_share_mean",
            "phys_hand_share_max", "phys_pull_mean", "phys_pull_max", "phys_feet_on_holds")


def features(result):
    """A fixed set of numbers that sum up the physics of one climb (the names in FEATURES).
    result: what plan() returned, or None when there was no hand sequence (all -1 then).

    phys_moves / phys_foot_moves  how many moves in all / how many are foot moves
    phys_effort_*                 effort of holding on while a limb moves: highest, average,
                                  average of the two highest; phys_hand_effort_* the same for hand moves only
    phys_unstable                 moves whose position cannot be held still (effort 1 or more)
    phys_unbalanced               moves where no sharing of the load balances at all
    phys_rest_effort_*            effort of the positions between moves, all limbs on
    phys_hand_share_*             share of all the force that goes through the hands, between moves
    phys_pull_*                   outward pull on the hands during moves, body-weights
    phys_feet_on_holds            average number of feet standing on a hold, between moves
    """
    if not result or not result["moves"]:
        out = dict.fromkeys(FEATURES, -1.0)
        out["phys_solved"] = 0
        return out
    moves, frames = result["moves"], result["frames"]
    eff = sorted((m["effort"] for m in moves), reverse=True)
    hand = [m["effort"] for m in moves if m["hand_move"] is not None]
    rest = [f["physics"].effort for f in frames]
    share = [f["physics"].hand_share() for f in frames]
    pull = [m["pull"] for m in moves]
    mean = lambda v: sum(v) / len(v)
    return {
        "phys_solved": 1,
        "phys_moves": len(moves),
        "phys_foot_moves": len(moves) - len(hand),
        "phys_effort_max": eff[0],
        "phys_effort_mean": mean(eff),
        "phys_effort_top2": mean(eff[:2]),
        "phys_hand_effort_max": max(hand),
        "phys_hand_effort_mean": mean(hand),
        "phys_unstable": sum(1 for m in moves if not m["stable"]),
        "phys_unbalanced": sum(1 for m in moves if not m["balanced"]),
        "phys_rest_effort_max": max(rest),
        "phys_rest_effort_mean": mean(rest),
        "phys_hand_share_mean": mean(share),
        "phys_hand_share_max": max(share),
        "phys_pull_mean": mean(pull),
        "phys_pull_max": max(pull),
        "phys_feet_on_holds": mean([sum(1 for v in f["on"].values() if v == "hold") for f in frames]),
    }
