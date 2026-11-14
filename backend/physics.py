"""Can a climber hold this position still, and how hard is it?

One position = which hold each hand and foot is on, where the body's centre of
mass is, and how steep the wall is. The answer is "effort": the share of their
maximum grip strength that the hardest-working hand needs. 1.0 or more means the
position cannot be held still (it has to be moved through quickly, or not at all).

WHAT IS ASSUMED (a photo cannot tell us any of this, so it is stated here)

Lengths are in any one unit (the callers use the solver's grid units, y up).
Forces are in body-weights.

 1. The model is flat with one correction ("2.5-D"). Forces along the wall
    (sideways and up the wall) and their turning effect must balance exactly.
    The pull straight out from the wall is one number shared by the hands.
 2. Gravity. On a wall that overhangs by A degrees, cos(A) of the body weight
    pulls down along the wall and sin(A) pulls the climber straight out from it.
    A slab (A below 0) presses the climber onto the wall instead.
 3. Hold direction is not known from a photo. Every hold is assumed to be
    mounted the usual way, with its good edge on top, so it works best when
    pulled straight down the wall. The hold type sets how far off that line the
    pull may be (HAND below): a big easy grip almost any direction, a squeeze
    grip well out to the side, a thin edge mostly downward, a rounded hold only
    close to straight down. A pull at the edge of that range is half as strong.
 4. Grip strength is that of a regular gym climber: on a perfect hold
    (quality 1) one hand can hold 1.2 body-weights, falling in a straight line
    with quality to 0.4 body-weights at quality 0. With the qualities in
    hold_types.json that makes hanging from two big easy grips 45% effort, from
    two thin edges 69%, and from one thin edge alone impossible (139%).
    These two numbers are a judgement, not a measurement.
 5. Pulling outward. The body's centre of mass sits `body_out` away from the
    wall (0.20 m for everyone). With feet on the wall the body is a lever
    hinged at the feet, so the hands must pull outward with
        (body_out * cos A + (height of centre of mass above the feet) * sin A)
        / (height of the hands above the feet)
    and never less than sin(A). With no feet they pull out sin(A) (a free hang).
    An outward pull costs more on holds with nothing to hook behind
    (rounded holds and big shapes three times as much as a big easy grip).
 6. Feet on a hold or on the floor can push up within 40 degrees of straight
    up, with no strength limit (legs are far stronger than fingers), and never
    count toward effort. The hold's type does not matter for a foot.
 7. A foot on the bare wall has only friction: 0.6 times how hard the lever in
    (5) presses the feet onto the wall. That is a little on a vertical wall,
    more on a slab, and it fades to nothing by 10 degrees of overhang.
 8. A position with a foot on the floor is worked out as if the wall were
    vertical: the ground carries the weight whatever the wall above does.
    (The caller does this by passing angle 0.)
 9. The climber shares the load between limbs in the way that makes the
    hardest-working hand work least. If asked, they also shift their weight
    sideways within the range the caller allows (x_lo .. x_hi).
10. Nothing moves. Swinging, jumping and momentum are not modelled.

HOW IT IS SOLVED

Each force is a mix of a few fixed directions with amounts that cannot be
negative. "Make the largest hand effort as small as possible while everything
balances" then becomes one small non-negative least-squares problem (at most
14 rows by 27 unknowns), solved with scipy.optimize.nnls in about 50
microseconds. The balance rows carry a large weight, so they hold to about one
millionth of a body-weight whenever balance is possible at all.
"""
import functools
import math

import numpy as np
from scipy.optimize import nnls

GRIP_MAX = 1.2          # body-weights one hand can hold on a perfect hold
GRIP_WORST = 0.4        # the same on a hold of quality 0
EDGE_STRENGTH = 0.5     # strength left when pulling at the very edge of a hold's range
MID_STRENGTH = 0.8      # strength left half-way to the edge
FOOT_CONE_DEG = 40.0    # a foot can push within this angle of straight up
SMEAR_FRICTION = 0.6    # rubber on bare wall
SMEAR_GONE_DEG = 10.0   # overhang at which a foot on bare wall is worth nothing
MIN_LEVER = 0.25        # shortest hands-above-feet distance used in the lever, as a share of height
BODY_OUT_M = 0.20       # how far the centre of mass sits from the wall, metres (hips kept close)
UNBALANCED = 1e-4       # body-weights of force left over before a position counts as "cannot balance"
MAX_EFFORT = 5.0        # efforts are reported up to this and no higher

# Hold type -> (how far off straight-down the pull may be, in degrees;
#               how much more an outward pull costs than a downward one).
HAND = {
    "jug":     (100.0, 1.0),   # big easy grip: almost any direction
    "pinch":   (70.0, 1.4),    # squeeze grip: also well out to the side
    "pocket":  (50.0, 1.2),    # finger hole
    "crimp":   (35.0, 1.6),    # thin edge: mostly downward
    "sloper":  (25.0, 3.0),    # rounded, no edge: the pull must press into it
    "volume":  (80.0, 1.5),    # big shape: pressed on from many directions, edges and corners to grab
    "foot":    (30.0, 2.0),    # a foot chip used by a hand
    "unknown": (50.0, 1.6),
}

_W = 1000.0             # weight on the rows that must hold exactly
_EPS_HAND = 0.03        # tie-breakers: spare the easier hand, spare the feet, stay near x_pref
_EPS_FOOT = 0.01
_EPS_X = 0.05


def _directions(half_deg, n):
    """n directions spread from -half_deg to +half_deg around straight up: (x parts, y parts)."""
    a = np.radians(np.linspace(-half_deg, half_deg, n))
    return np.sin(a), np.cos(a)


def _hand_table(kind):
    half, out_cost = HAND.get(kind, HAND["unknown"])
    gx, gy = _directions(half, 5)
    cost = [1 / EDGE_STRENGTH, 1 / MID_STRENGTH, 1.0, 1 / MID_STRENGTH, 1 / EDGE_STRENGTH]
    return gx.tolist(), gy.tolist(), cost, out_cost


_HAND_TABLES = {k: _hand_table(k) for k in HAND}
_FOOT_GX, _FOOT_GY = (v.tolist() for v in _directions(FOOT_CONE_DEG, 3))


def grip_strength(quality):
    """Body-weights one hand can hold on a hold of this quality (0 worst, 1 best)."""
    q = min(max(float(quality), 0.0), 1.0)
    return GRIP_WORST + (GRIP_MAX - GRIP_WORST) * q


@functools.lru_cache(maxsize=256)
def _angle(angle_deg):
    a = math.radians(angle_deg)
    smear = SMEAR_FRICTION * min(1.0, max(0.0, 1.0 - angle_deg / SMEAR_GONE_DEG))
    return math.cos(a), math.sin(a), smear


class Result:
    """What solve() returns.

    effort   largest hand effort (0 or more; 1 or more cannot be held)
    stable   True when the forces balance and effort is below 1
    balanced True when the forces balance at all, whatever the effort
    com_x    where the centre of mass ended up, sideways
    pull     total outward pull on the hands, body-weights
    forces   {limb: (sideways, up the wall, out from the wall)}: the force the
             wall puts on that limb, body-weights, in the wall's own axes
    efforts  {hand: effort of that hand}
    """
    __slots__ = ("effort", "stable", "balanced", "com_x", "pull", "forces", "efforts", "angle_deg")

    def photo_forces(self):
        """{limb: (fx, fy, share)} as seen in a photo: x right, y DOWN, so holding the
        climber up is a negative fy. fy is the true vertical part of the force (the part
        along the wall and the part out from it, combined), so over all limbs fx adds up
        to 0 and fy to -1 when the position balances. share is this limb's part of all
        the force, by size, 0..1."""
        c, s, _ = _angle(self.angle_deg)
        size = {k: math.sqrt(fx * fx + fy * fy + out * out) for k, (fx, fy, out) in self.forces.items()}
        total = sum(size.values()) or 1.0
        return {k: (fx, -(fy * c - out * s), size[k] / total) for k, (fx, fy, out) in self.forces.items()}

    def hand_share(self):
        """Share of all the force that goes through the hands, 0..1."""
        f = self.photo_forces()
        return sum(v[2] for k, v in f.items() if k[1] == "H")


def solve(hands, feet, com_y, x_lo, x_hi=None, angle_deg=0.0, height=8.75, body_out=1.5, x_pref=None):
    """Work out one position.

    hands: [(limb, x, y, hold type, quality 0..1)]  for each hand that is on a hold ("LH", "RH")
    feet:  [(limb, x, y, kind)]                     for each foot that is on something ("LF", "RF");
           kind is "hold", "floor" or "wall" (bare wall, friction only)
    com_y: height of the centre of mass
    x_lo, x_hi: the centre of mass may sit anywhere from x_lo to x_hi sideways and the
           best place is found; leave x_hi out to fix it at x_lo
    angle_deg: overhang in degrees (0 vertical, above 0 overhanging, below 0 slab)
    height: the climber's height, body_out: centre of mass to wall, same length unit as x, y
    x_pref: where the centre of mass would rather be when effort is the same anywhere
    Returns a Result.
    """
    c, s, smear_mu = _angle(angle_deg)
    nh, nf = len(hands), len(feet)
    res = Result()
    res.angle_deg = angle_deg
    if x_hi is None or x_hi < x_lo:
        x_hi = x_lo
    free = x_hi - x_lo > 1e-9
    if x_pref is None:
        x_pref = 0.5 * (x_lo + x_hi)
    x_pref = min(max(x_pref, x_lo), x_hi)

    # Assumption 5: the outward pull the hands must supply, and how hard the feet press on the wall.
    if nf:
        yf = sum(f[2] for f in feet) / nf
        if nh:
            yh = sum(h[2] for h in hands) / nh
            lever = (body_out * c + (com_y - yf) * s) / max(yh - yf, MIN_LEVER * height)
            pull = max(lever, s, 0.0)
        else:
            pull = 0.0
        press = (pull - s) / nf if nh else 0.0          # each foot's push out from the wall
    else:
        pull, press = max(s, 0.0), 0.0
    res.pull = pull

    if nh == 0:
        # No hands: the feet carry everything or nothing does. Not used by the planner.
        on = [f for f in feet if f[3] != "wall"]
        res.com_x, res.efforts = x_pref, {}
        res.forces = {f[0]: (0.0, c / len(on) if f in on else 0.0, 0.0) for f in feet}
        res.balanced = bool(on)
        res.effort = 0.0 if on else MAX_EFFORT
        res.stable = bool(on)
        return res

    lm = 0.5 * height                                   # length that turns a turning moment into a force
    # Unknowns, all >= 0. Column 0 is t, the largest hand effort; 1 and 2 place the centre of mass.
    col = 3
    hand_cols, foot_cols = [], []
    for _ in hands:
        hand_cols.append(col)
        col += 7                                        # 5 directions, outward pull, spare effort
    for f in feet:
        if f[3] == "wall":
            cap = smear_mu * press
            if cap <= 1e-9:
                foot_cols.append(None)                  # no friction to be had: this foot carries nothing
                continue
            foot_cols.append(col)
            col += 4                                    # 3 directions, unused friction
        else:
            foot_cols.append(col)
            col += 3
    n_rows = 7 + 2 * nh + 2 * nf
    # The matrix is filled as one flat list (row r, column j is at r * col + j): for a
    # problem this small that is several times faster than writing into a numpy array.
    A = [0.0] * (n_rows * col)
    b = [0.0] * n_rows
    # Rows: 0 sideways balance, 1 up-the-wall balance, 2 turning balance, 3 outward pull,
    #       4 centre-of-mass range, 5 make t small, 6 stay near x_pref, then two per limb.
    r2, r3 = 2 * col, 3 * col
    w_lm = _W / lm
    b[1] = _W * c
    b[3] = _W * pull
    A[5 * col] = 1.0
    if free:
        A[r2 + 1] = -w_lm * c
        A[4 * col + 1] = A[4 * col + 2] = w_lm
        b[4] = w_lm * (x_hi - x_lo)
        A[6 * col + 1] = _EPS_X / height
        b[6] = _EPS_X * (x_pref - x_lo) / height
    row = 7 * col
    for (limb, x, y, kind, quality), j in zip(hands, hand_cols):
        gx, gy, cost, out_cost = _HAND_TABLES.get(kind) or _HAND_TABLES["unknown"]
        inv = 1.0 / grip_strength(quality)
        dx, dy = (x - x_lo) * w_lm, (y - com_y) * w_lm
        nxt = row + col
        for g in range(5):
            A[j + g] = _W * gx[g]
            A[col + j + g] = _W * gy[g]
            A[r2 + j + g] = dx * gy[g] - dy * gx[g]
            A[row + j + g] = _W * inv * cost[g]           # this hand's effort + spare = t
            A[nxt + j + g] = _EPS_HAND * inv * cost[g]    # tie-breaker: keep this hand's own effort small too
        A[r3 + j + 5] = _W
        A[row + j + 5] = _W * out_cost * inv
        A[row + j + 6] = _W
        A[row] = -_W
        A[nxt + j + 5] = _EPS_HAND * out_cost * inv
        row = nxt + col
    for (limb, x, y, kind), j in zip(feet, foot_cols):
        if j is not None:
            dx, dy = (x - x_lo) * w_lm, (y - com_y) * w_lm
            for g in range(3):
                A[j + g] = _W * _FOOT_GX[g]
                A[col + j + g] = _W * _FOOT_GY[g]
                A[r2 + j + g] = dx * _FOOT_GY[g] - dy * _FOOT_GX[g]
                A[row + j + g] = _EPS_FOOT
            if kind == "wall":                          # friction used + friction unused = friction available
                nxt = row + col
                A[nxt + j] = A[nxt + j + 1] = A[nxt + j + 2] = A[nxt + j + 3] = _W
                b[row // col + 1] = _W * smear_mu * press
        row += 2 * col
    A = np.array(A).reshape(n_rows, col)
    b = np.array(b)

    try:
        v, _ = nnls(A, b, maxiter=20 * col)
    except RuntimeError:                                # did not settle: report it as a position that cannot be held
        v = None
    if v is None:
        res.com_x, res.efforts = x_pref, {h[0]: MAX_EFFORT for h in hands}
        res.forces = {h[0]: (0.0, 0.0, 0.0) for h in hands}
        res.forces.update({f[0]: (0.0, 0.0, 0.0) for f in feet})
        res.balanced, res.stable, res.effort = False, False, MAX_EFFORT
        return res

    v = v.tolist()
    com_x = x_lo + (v[1] if free else 0.0)
    forces, efforts = {}, {}
    sum_x = sum_y = turn = sum_out = 0.0
    slab_rest = max(-s, 0.0) / nh if not nf else 0.0    # no feet on a slab: the body rests on the wall
    for (limb, x, y, kind, quality), j in zip(hands, hand_cols):
        gx, gy, cost, out_cost = _HAND_TABLES.get(kind) or _HAND_TABLES["unknown"]
        fx = fy = work = 0.0
        for g in range(5):
            a = v[j + g]
            if a:
                fx += a * gx[g]
                fy += a * gy[g]
                work += a * cost[g]
        out = v[j + 5]
        efforts[limb] = (work + out_cost * out) / grip_strength(quality)
        forces[limb] = (fx, fy, slab_rest - out)
        sum_x += fx
        sum_y += fy
        sum_out += out
        turn += (x - com_x) * fy - (y - com_y) * fx
    for (limb, x, y, kind), j in zip(feet, foot_cols):
        if j is None:
            forces[limb] = (0.0, 0.0, press)
            continue
        fx = fy = 0.0
        for g in range(3):
            fx += v[j + g] * _FOOT_GX[g]
            fy += v[j + g] * _FOOT_GY[g]
        forces[limb] = (fx, fy, press)
        sum_x += fx
        sum_y += fy
        turn += (x - com_x) * fy - (y - com_y) * fx
    left_over = math.sqrt(sum_x ** 2 + (sum_y - c) ** 2 + (turn / lm) ** 2 + (sum_out - pull) ** 2)
    effort = max(efforts.values())
    res.com_x, res.forces, res.efforts = com_x, forces, efforts
    res.balanced = left_over < UNBALANCED
    if not res.balanced:
        effort = max(effort, 1.0) + left_over
    res.effort = min(effort, MAX_EFFORT)
    res.stable = res.balanced and res.effort < 1.0
    return res
