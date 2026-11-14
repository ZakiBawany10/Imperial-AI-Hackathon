"""Turn solved hand positions into stick-figure poses for the animation.

All positions are pixels of the photo (y grows downward). The figure is a true
stick figure: both arms start at the neck and both legs start at the hip, so
the frontend can draw it from the contract joints alone. The neck is not sent;
it sits on the head-to-hip line, NECK_FRACTION of the way down from the head.

This is a drawing aid, not physics: it places the body where the hands allow
and puts feet on route holds when one is in a sensible place, else on the wall.
"""
import math

# Segment lengths as a share of climber height.
ARM_UPPER, ARM_FORE = 0.25, 0.265      # neck to elbow, elbow to grip (includes half the shoulders)
HEAD, TORSO = 0.11, 0.29               # head centre to neck, neck to hip
THIGH, SHIN = 0.245, 0.26
NECK_FRACTION = HEAD / (HEAD + TORSO)  # 0.275


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
