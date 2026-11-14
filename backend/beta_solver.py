"""Tiny hand-sequence ("beta") solver for a board problem.

A state is (left-hand hold, right-hand hold). A move changes one hand.
Dijkstra finds the cheapest sequence from the start holds to a finish hold.
The cost of a move is a load proxy: how far the body is stretched, how far the
hand travels, and how bad the holds are for the hand using them.

This is the cut-down version of the full four-limb equilibrium model: no feet
in the state and no force balance yet. It exists to test one question quickly:
do features from a solved sequence predict the grade better than the raw holds?
"""
import heapq
import math
import os

REACH = 9.0          # max hand-to-hand span in grid units (about 0.2 m each)
CROSS_LIMIT = 2      # how far the left hand may sit to the right of the right hand
# Extra cost for moves near full reach: a move's distance cost is multiplied by
# 1 + STRETCH * (span / REACH) ** 3. 0 turns it off (the original linear cost).
# Grade error with 0 / 1.5 / 3:  Kilter 1.39 / 1.33 / 1.30,  MoonBoard 0.98 / 0.95 / 0.94.
STRETCH = float(os.environ.get("BETA_STRETCH", "3"))


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def solve(holds, start_idx, end_idx, bad_left, bad_right, usable=None):
    """holds: list of (x, y). bad_*: dict (x, y) -> 0..1, 1 = worst hold.
    usable: optional set of hold indices a hand may move to (default: all).

    Returns a list of per-move dicts, or None if no sequence was found.
    """
    n = len(holds)
    if len(start_idx) >= 2:
        a, b = sorted(start_idx[:2], key=lambda i: holds[i][0])
        init = (a, b)
    else:
        init = (start_idx[0], start_idx[0])
    ends = set(end_idx)

    def badness(i, hand):
        table = bad_left if hand == 0 else bad_right
        return table.get(tuple(holds[i]), 0.5)

    best = {init: 0.0}
    prev = {}
    heap = [(0.0, init)]
    goal = None
    while heap:
        cost, state = heapq.heappop(heap)
        if cost > best.get(state, 1e18):
            continue
        if state[0] in ends or state[1] in ends:
            goal = state
            break
        low_y = min(holds[state[0]][1], holds[state[1]][1])
        for hand in (0, 1):
            cur, other = state[hand], state[1 - hand]
            for h in range(n):
                if h == cur or (usable is not None and h not in usable):
                    continue
                if holds[h][1] < low_y - 2:          # no big down-climbs
                    continue
                span = _dist(holds[other], holds[h])
                if span > REACH:
                    continue
                nxt = (h, other) if hand == 0 else (other, h)
                if holds[nxt[0]][0] - holds[nxt[1]][0] > CROSS_LIMIT:
                    continue
                travel = _dist(holds[cur], holds[h])
                b_new = badness(h, hand)
                b_hold = badness(other, 1 - hand)
                step = ((0.6 * span + 0.4 * travel) * (1.0 + 1.5 * b_new) * (1.0 + STRETCH * (span / REACH) ** 3)
                        + 2.0 * b_hold + 0.5)
                new_cost = cost + step
                if new_cost < best.get(nxt, 1e18):
                    best[nxt] = new_cost
                    prev[nxt] = (state, dict(cost=step, span=span, travel=travel,
                                             bad_new=b_new, bad_hold=b_hold, hand=hand,
                                             to=h, rise=holds[h][1] - holds[cur][1],
                                             state=nxt))
                    heapq.heappush(heap, (new_cost, nxt))
    if goal is None:
        return None
    moves = []
    s = goal
    while s in prev:
        s, info = prev[s]
        moves.append(info)
    moves.reverse()
    return moves


def features(holds, start_idx, end_idx, bad_left, bad_right):
    """Fixed-length feature dict for one problem."""
    ys = [h[1] for h in holds]
    xs = [h[0] for h in holds]
    both = [(bad_left.get(tuple(h), 0.5) + bad_right.get(tuple(h), 0.5)) / 2 for h in holds]
    f = {
        "n_holds": len(holds),
        "n_start": len(start_idx),
        "n_end": len(end_idx),
        "x_range": max(xs) - min(xs),
        "y_range": max(ys) - min(ys),
        "bad_mean_all": sum(both) / len(both),
        "bad_max_all": max(both),
        "bad_min_all": min(both),
    }
    moves = solve(holds, start_idx, end_idx, bad_left, bad_right)
    f["solved"] = int(moves is not None and len(moves) > 0)
    if not f["solved"]:
        for k in ("n_moves", "cost_sum", "cost_max", "cost_mean", "cost_top2", "span_max",
                  "span_mean", "travel_max", "travel_mean", "bad_path_max", "bad_path_mean",
                  "bad_hold_max", "holds_unused", "hand_switches", "rise_max"):
            f[k] = -1.0
        return f
    costs = sorted((m["cost"] for m in moves), reverse=True)
    used = {m["to"] for m in moves} | set(start_idx)
    f.update({
        "n_moves": len(moves),
        "cost_sum": sum(costs),
        "cost_max": costs[0],
        "cost_mean": sum(costs) / len(costs),
        "cost_top2": sum(costs[:2]) / min(2, len(costs)),
        "span_max": max(m["span"] for m in moves),
        "span_mean": sum(m["span"] for m in moves) / len(moves),
        "travel_max": max(m["travel"] for m in moves),
        "travel_mean": sum(m["travel"] for m in moves) / len(moves),
        "bad_path_max": max(m["bad_new"] for m in moves),
        "bad_path_mean": sum(m["bad_new"] for m in moves) / len(moves),
        "bad_hold_max": max(m["bad_hold"] for m in moves),
        "holds_unused": len(holds) - len(used),
        "hand_switches": sum(1 for a, b in zip(moves, moves[1:]) if a["hand"] != b["hand"]),
        "rise_max": max(m["rise"] for m in moves),
    })
    return f
