"""Stick-figure poses for the animation, and the body's reach limits.

The figure is a true stick figure: both arms start at the neck and both legs
start at the hip, so the frontend can draw it from the contract joints alone.
The neck is not sent; it sits on the head-to-hip line, NECK_FRACTION of the way
down from the head. The torso is always upright.

Two ways in:

- keyframes(): hands only, in photo pixels (y grows downward). It places the
  body where the hands allow and puts feet on a nearby hold or the wall with no
  physics. This is what "limbs": "hands" returns and it is left exactly as it was.
- body_x_ranges(), neck_height(), wall_foot(), centre_of_mass() and figure():
  the pieces limbs.py uses to build a pose from chosen contacts (which hold each
  hand and foot is on). The first four work in any length unit with y growing
  UPWARD (limbs.py uses the solver's grid units); figure() draws in photo pixels.
"""
import math

import numpy as np

# Segment lengths as a share of climber height.
ARM_UPPER, ARM_FORE = 0.25, 0.265      # neck to elbow, elbow to grip (includes half the shoulders)
HEAD, TORSO = 0.11, 0.29               # head centre to neck, neck to hip
THIGH, SHIN = 0.245, 0.26
NECK_FRACTION = HEAD / (HEAD + TORSO)  # 0.275

# Limits used when the pose is built from chosen contacts. All are shares of climber height
# unless they say otherwise.
ARM = ARM_UPPER + ARM_FORE             # neck to grip, the furthest a hand can be from the neck
LEG = THIGH + SHIN                     # hip to foot
FOOT_REACH = 0.97                      # a foot on a hold is at most this share of a full leg from the hip
FOOT_BELOW_HIP = 0.12                  # ... and at least this far below the hip
HANG = 0.7                             # the body hangs this share of a full arm below the hands when it can (bent arms, weight on the feet)
SQUAT = 0.2                            # the hip stays at least this far above the floor
WALL_FOOT_OUT = 0.12                   # a foot on the bare wall sits this far to its own side of the hip
WALL_FOOT_DOWN = 0.8                   # ... and this share of a full leg below it
FLOOR_FOOT_OUT = 0.05                  # a foot on the floor sits this far to its own side of the neck
COM_DOWN = 0.8                         # the centre of mass is this share of the way from neck to hip
NECK_OVER_HANDS = 0.25                 # the neck goes at most this far above the higher hand: hands at chest height when standing (was 0.05, which squatted the climber under low holds)
STAND = 0.85                           # when the hands are low the body stands up, hip this share of a leg over its highest foot (or the floor), instead of squatting


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _two_bone(root, target, l1, l2, prefer):
    """Middle joint (elbow or knee) of a two-segment limb from root to target.
    Of the two possible bends, returns the one with the higher prefer(point)."""
    dx, dy = target[0] - root[0], target[1] - root[1]
    d = math.hypot(dx, dy)
    if d < 1e-6:
        return (root[0], root[1] + l1)
    ux, uy = dx / d, dy / d
    # A limb bent toward the camera looks shorter. Without this, a hand close to the
    # neck would throw the elbow far out to the side.
    shrink = min(1.0, max(d / (0.85 * (l1 + l2)), 0.45))
    l1, l2 = l1 * shrink, l2 * shrink
    if d >= l1 + l2:                                   # over-stretched: joint on the straight line
        t = l1 / (l1 + l2)
        return (root[0] + dx * t, root[1] + dy * t)
    d = max(d, abs(l1 - l2) + 1e-6)
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(l1 * l1 - a * a, 0.0))
    px, py = root[0] + ux * a, root[1] + uy * a
    options = [(px - uy * h, py + ux * h), (px + uy * h, py - ux * h)]
    return max(options, key=prefer)


def _neck(lh, rh, arm, height_px, ground_y):
    """Hang as low under the hands as the arms allow, without sinking below the floor."""
    x = (lh[0] + rh[0]) / 2
    lowest_ok, highest_ok = [], []
    for hx, hy in (lh, rh):
        dx = abs(hx - x)
        lowest_ok.append(hy + math.sqrt(max((0.92 * arm) ** 2 - dx * dx, 0.0)))
        highest_ok.append(hy - math.sqrt(max(arm * arm - dx * dx, 0.0)))
    y = min(lowest_ok)
    top = max(highest_ok)
    if y < top:                                        # hands too far apart vertically: split the difference
        y = (y + top) / 2
    floor_limit = ground_y - (TORSO + 0.2) * height_px  # leave room to squat on the floor
    return x, min(y, max(floor_limit, top))


def _feet(hip, holds, in_hand, prev, leg, height_px, ground_y):
    """Pick a hold (or the wall) for each foot. Returns ((x, y), (x, y), (left_idx, right_idx))."""
    cands = [None] + [i for i, p in enumerate(holds)
                      if i not in in_hand and p[1] > hip[1] + 0.12 * height_px and _dist(hip, p) <= 0.97 * leg]

    def cost(i, side, prev_i):
        if i is None:
            return 1.0                                 # standing on the bare wall is the last resort
        x, y = holds[i]
        c = abs(_dist(hip, (x, y)) - 0.8 * leg) / leg + 0.6 * abs((x - hip[0]) - side * 0.12 * height_px) / height_px
        return c - (0.25 if i == prev_i else 0.0)      # keep a foot where it is when possible

    best, best_cost = (None, None), 1e9
    for li in cands:
        for ri in cands:
            if li is not None and li == ri:
                continue
            c = cost(li, -1, prev[0]) + cost(ri, +1, prev[1])
            if li is not None and ri is not None and holds[li][0] > holds[ri][0]:
                c += 1.0                               # crossed feet
            if c < best_cost:
                best, best_cost = (li, ri), c

    def place(i, side):
        if i is not None:
            return holds[i]
        return (hip[0] + side * 0.12 * height_px, min(hip[1] + 0.8 * leg, ground_y))

    return place(best[0], -1), place(best[1], +1), best


def keyframes(holds, widths, states, height_px, image_h):
    """holds: [(x, y)] pixel centres of every route hold, feet included.
    widths: pixel width of each hold. states: [(left_hand_idx, right_hand_idx)],
    the start position followed by the position after each move.
    Returns one {"move": k, "joints": {...}} per state; k is the number of moves done."""
    arm = (ARM_UPPER + ARM_FORE) * height_px
    leg = (THIGH + SHIN) * height_px
    ground_y = image_h - 2
    out, prev_feet = [], (None, None)
    for k, (li, ri) in enumerate(states):
        lh, rh = holds[li], holds[ri]
        if li == ri:                                   # both hands share a hold: put them side by side
            off = min(widths[li] / 4, 0.04 * height_px)
            lh, rh = (lh[0] - off, lh[1]), (rh[0] + off, rh[1])
        neck = _neck(lh, rh, arm, height_px, ground_y)
        head = (neck[0], neck[1] - HEAD * height_px)
        hip = (neck[0], neck[1] + TORSO * height_px)
        lf, rf, prev_feet = _feet(hip, holds, {li, ri}, prev_feet, leg, height_px, ground_y)
        joints = {
            "head": head, "hip": hip, "lh": lh, "rh": rh,
            # elbows point out and down, knees point out and up
            "l_elbow": _two_bone(neck, lh, ARM_UPPER * height_px, ARM_FORE * height_px, lambda p: -p[0] + 0.5 * p[1]),
            "r_elbow": _two_bone(neck, rh, ARM_UPPER * height_px, ARM_FORE * height_px, lambda p: p[0] + 0.5 * p[1]),
            "lf": lf, "rf": rf,
            "l_knee": _two_bone(hip, lf, THIGH * height_px, SHIN * height_px, lambda p: -p[0] - 0.3 * p[1]),
            "r_knee": _two_bone(hip, rf, THIGH * height_px, SHIN * height_px, lambda p: p[0] - 0.3 * p[1]),
        }
        out.append({"move": k, "joints": {n: [round(p[0]), round(p[1])] for n, p in joints.items()}})
    return out


# ---- Poses from chosen contacts. Lengths in any one unit, y grows UPWARD. ----

def _gap(xs, cx, cy, r, y_min, y_max):
    """For each row (one set of contacts) and each neck x in xs: how much room there is,
    top to bottom, for the neck. Below 0 means no neck height works at that x."""
    d = xs[:, None, :] - cx[:, :, None]
    room = r[:, :, None] ** 2 - d * d
    half = np.sqrt(np.maximum(room, 0.0))
    top = np.minimum((cy[:, :, None] + half).min(1), y_max)
    bottom = np.maximum((cy[:, :, None] - half).max(1), y_min[:, None])
    return np.where((room >= -1e-12).all(1), top - bottom, -1.0)


def body_x_ranges(hands, feet_sets, height, floor=None):
    """Where the body can be, sideways, with every limb still within reach.

    hands: [(x, y)] for the one or two hands on holds. feet_sets: a list of candidate
    foot placements, each a tuple of 0, 1 or 2 (x, y) points for feet that are on holds
    (a foot on the bare wall goes wherever the body is, so it sets no limit).
    floor: height of the floor, or None for no floor rule.
    Returns one (x_lo, x_hi) per candidate: the neck may be anywhere from x_lo to x_hi.
    None means the limbs cannot all reach at once.

    The neck must be within one arm of each hand and no more than NECK_OVER_HANDS above
    the higher one; the hip (one torso below the neck) within FOOT_REACH of a leg of each
    foot and at least FOOT_BELOW_HIP above it, and SQUAT above the floor. Each limit is a
    circle or a straight line, so the allowed area has no dents and its x range is found
    by sampling: 17 points across, then 9 more around each end, which is good to about a
    hundredth of the climber's height.
    """
    arm, leg, torso = ARM * height, FOOT_REACH * LEG * height, TORSO * height
    n = len(feet_sets)
    (ax, ay), (bx, by) = hands[0], hands[-1]
    floor_min = -math.inf if floor is None else floor + (TORSO + SQUAT) * height
    y_max = max(max(ay, by) + NECK_OVER_HANDS * height, floor_min)
    foot_min = torso + FOOT_BELOW_HIP * height
    cx, cy, r, y_min = [], [], [], []
    for feet in feet_sets:
        if len(feet) == 2:
            (fx, fy), (gx, gy) = feet
            cx.append((ax, bx, fx, gx)); cy.append((ay, by, fy + torso, gy + torso)); r.append((arm, arm, leg, leg))
            y_min.append(max(floor_min, fy + foot_min, gy + foot_min))
        elif feet:
            fx, fy = feet[0]
            cx.append((ax, bx, fx, ax)); cy.append((ay, by, fy + torso, ay)); r.append((arm, arm, leg, arm))
            y_min.append(max(floor_min, fy + foot_min))
        else:                                             # unused foot slots repeat the hands
            cx.append((ax, bx, ax, bx)); cy.append((ay, by, ay, by)); r.append((arm, arm, arm, arm))
            y_min.append(floor_min)
    cx, cy, r, y_min = np.array(cx), np.array(cy), np.array(r), np.array(y_min)

    lo, hi = (cx - r).max(1), (cx + r).min(1)
    width = np.maximum(hi - lo, 0.0)
    xs = lo[:, None] + width[:, None] * np.linspace(0.0, 1.0, 17)
    gap = _gap(xs, cx, cy, r, y_min, y_max)
    ok = gap >= 0
    found = ok.any(1)
    rows = np.arange(n)
    first, last = ok.argmax(1), 16 - ok[:, ::-1].argmax(1)
    best = gap.argmax(1)                                  # where to look closer when nothing fitted
    a1 = np.where(found, xs[rows, np.maximum(first - 1, 0)], xs[rows, np.maximum(best - 1, 0)])
    b1 = np.where(found, xs[rows, first], xs[rows, best])
    a2 = np.where(found, xs[rows, last], xs[rows, best])
    b2 = np.where(found, xs[rows, np.minimum(last + 1, 16)], xs[rows, np.minimum(best + 1, 16)])
    t = np.linspace(0.0, 1.0, 9)
    xs2 = np.concatenate([a1[:, None] + (b1 - a1)[:, None] * t, a2[:, None] + (b2 - a2)[:, None] * t], 1)
    ok2 = _gap(xs2, cx, cy, r, y_min, y_max) >= 0
    x_lo = np.where(ok2, xs2, np.inf).min(1)
    x_hi = np.where(ok2, xs2, -np.inf).max(1)
    x_lo = np.where(found, np.minimum(x_lo, xs[rows, first]), x_lo)
    x_hi = np.where(found, np.maximum(x_hi, xs[rows, last]), x_hi)
    good = (hi >= lo) & (x_hi >= x_lo)
    return [(float(a), float(b)) if g else None for a, b, g in zip(x_lo, x_hi, good)]


def neck_height(x, hands, feet, height, floor=None, hang=HANG):
    """Height of the neck when it is at sideways position x: hanging `hang` of an arm below
    the hands when the feet and the floor leave room for that, otherwise as close to that
    as the reach limits allow. hands, feet, floor as in body_x_ranges (feet on holds only);
    x must be inside the range that function returned."""
    arm, leg, torso = ARM * height, FOOT_REACH * LEG * height, TORSO * height
    low, want = -math.inf, -math.inf
    floor_min = -math.inf if floor is None else floor + (TORSO + SQUAT) * height
    high = max(max(hands[0][1], hands[-1][1]) + NECK_OVER_HANDS * height, floor_min)
    for hx, hy in hands:
        d2 = (x - hx) ** 2
        half = math.sqrt(max(arm * arm - d2, 0.0))
        low, high = max(low, hy - half), min(high, hy + half)
        hang2 = (hang * arm) ** 2 - d2
        want = max(want, hy - math.sqrt(hang2) if hang2 > 0 else hy)
    for fx, fy in feet:
        half = math.sqrt(max(leg * leg - (x - fx) ** 2, 0.0))
        low = max(low, fy + torso - half, fy + torso + FOOT_BELOW_HIP * height)
        high = min(high, fy + torso + half)
        if STAND:
            want = max(want, fy + torso + STAND * math.sqrt(max(leg * leg - (x - fx) ** 2, 0.0)))
    if STAND and floor is not None and not feet:
        want = max(want, floor + torso + STAND * leg)
    low = max(low, floor_min)
    if low > high:                                        # only by rounding, at the very end of the range
        return 0.5 * (low + high)
    return min(max(want, low), high)


def wall_foot(neck, side, height, floor=None):
    """Where a foot that is not on a hold goes: side is -1 for the left foot, +1 for the
    right. Returns ((x, y), on_floor). on_floor is True when the foot reaches the floor,
    which then carries weight like the ground it is."""
    x = neck[0] + side * WALL_FOOT_OUT * height
    y = neck[1] - TORSO * height - WALL_FOOT_DOWN * LEG * height
    # Standing in the start position: the foot is on the floor whenever the leg reaches it.
    if floor is not None and (y <= floor or (STAND and neck[1] - TORSO * height - floor <= LEG * height)):
        # Standing on the ground: the foot goes under the body, not out to the side.
        return (neck[0] + side * FLOOR_FOOT_OUT * height, floor), True
    return (x, y), False


def centre_of_mass(neck, height):
    """The body's centre of mass: on the upright torso, COM_DOWN of the way from neck to hip."""
    return neck[0], neck[1] - COM_DOWN * TORSO * height


# ---- Drawing, in photo pixels (y grows DOWNWARD). ----

def figure(neck, lh, rh, lf, rf, height_px):
    """The ten contract joints for a body whose neck, hands and feet are at the given
    pixel points. Hands and feet are used exactly as given, so they sit on their holds.
    Returns {"head": [x, y], ...} with whole-pixel numbers."""
    head = (neck[0], neck[1] - HEAD * height_px)
    hip = (neck[0], neck[1] + TORSO * height_px)
    joints = {
        "head": head, "hip": hip, "lh": lh, "rh": rh,
        # elbows point out and down, knees point out and up
        "l_elbow": _two_bone(neck, lh, ARM_UPPER * height_px, ARM_FORE * height_px, lambda p: -p[0] + 0.5 * p[1]),
        "r_elbow": _two_bone(neck, rh, ARM_UPPER * height_px, ARM_FORE * height_px, lambda p: p[0] + 0.5 * p[1]),
        "lf": lf, "rf": rf,
        "l_knee": _two_bone(hip, lf, THIGH * height_px, SHIN * height_px, lambda p: -p[0] - 0.3 * p[1]),
        "r_knee": _two_bone(hip, rf, THIGH * height_px, SHIN * height_px, lambda p: p[0] - 0.3 * p[1]),
    }
    return {name: [round(p[0]), round(p[1])] for name, p in joints.items()}
