// One shape for "a solved route" that Route, Play and Live draw. Two sources:
//  - realBeta: the backend's POST /solve answer (the prototype flow)
//  - mockBeta: the design mock in lib/wall.ts (the Board frames)
// Everything is in overlay units (1000 wide, see lib/contract.ts).

import { describeMove } from "@coach/coachTools.js";
import type { Limb, SolveRequest, SolveResponse } from "./api";
import {
  HOLDS,
  TYPE_INFO,
  betaFor,
  gradeFor,
  holdById,
  placementAt,
  placements,
  skeleton,
  type Hold,
  type Pt,
} from "./wall";

export type Pose = ReturnType<typeof skeleton>;
export type BetaMove = {
  limb: Limb;
  /** null: a foot smearing on the wall, no hold */
  hold: Hold | null;
  /** where the limb ends up */
  at: Pt;
  /** short label for the target hold, e.g. route number "04" */
  label: string;
  text: string;
  /** real /solve: chance of falling off on this move (0 to 1) */
  fall?: number;
  /** real /solve: share of grip strength this move needs (1.0 or more can't be held) */
  effort?: number;
};
export type BetaView = {
  moves: BetaMove[];
  /** 1-based move number of the crux */
  crux: number;
  grade: { font: string; v: string; range: string };
  /** route holds, bottom to top (numbered on the photo), and the rest of the wall */
  route: Hold[];
  others: Hold[];
  /** overlay ids of the start and finish holds */
  start: string[];
  finish: string[];
  colour: string;
  /** height / width of the photo; undefined for the square mock */
  aspect?: number;
  unitsPerMetre: number;
  /** real /solve: chance of topping the route on this sequence (0 to 1) */
  finishChance?: number;
  /** real /solve: each limb's share of the body weight in keyframe k (0 to 1) */
  loadsAt?: (k: number) => Record<Limb, number> | null;
  /** pose at t in [0, moves.length]: t = k is the pose after k moves */
  poseAt: (t: number) => Pose;
};

export const LIMB_NAME: Record<Limb, string> = {
  LH: "Left hand",
  RH: "Right hand",
  LF: "Left foot",
  RF: "Right foot",
};
const OTHER: Record<Limb, Limb> = { LH: "RH", RH: "LH", LF: "RF", RF: "LF" };

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/* ---------- design mock ---------- */
export function mockBeta(height: number, wallH: number, angle = "vertical"): BetaView {
  const b = betaFor(height);
  const list = placements(b.moves);
  const H = (height * 1000) / wallH;
  const g = gradeFor(height, angle);
  const route = HOLDS.filter((h) => h.colour === "blue").sort((a, b) => b.y - a.y);
  return {
    moves: b.moves.map((m) => {
      const limb: Limb = m.limbs.RH ? "RH" : m.limbs.LH ? "LH" : m.limbs.LF ? "LF" : "RF";
      const hold = holdById(m.limbs[limb]!);
      return { limb, hold, at: hold, label: hold.tag, text: m.text };
    }),
    crux: b.crux,
    grade: { font: g.grade, v: g.v, range: g.range },
    route,
    others: HOLDS.filter((h) => h.colour !== "blue"),
    start: ["y1", "y2"],
    finish: ["y8"],
    colour: "blue",
    unitsPerMetre: 1000 / wallH,
    poseAt: (t) => skeleton(placementAt(list, t), H),
  };
}

/* ---------- real /solve answer ---------- */
export function realBeta(
  res: SolveResponse,
  o: {
    /** the request that produced `res`, for the coach's move descriptions */
    req?: SolveRequest;
    holdTypes?: unknown;
    imageW: number;
    aspect: number;
    wallH: number;
    colour: string;
    route: Hold[];
    others: Hold[];
    byId: Map<number, Hold>;
  },
): BetaView {
  const k = 1000 / o.imageW;
  const P = (p: [number, number]): Pt => ({ x: p[0] * k, y: p[1] * k });
  const poses: Pose[] = res.keyframes.map(({ joints: j }) => {
    const head = P(j.head);
    const hip = P(j.hip);
    // contract/README.md: neck is 27.5% of the way from head to hip
    const neck = lerp(head, hip, 0.275);
    return {
      head,
      headR: dist(head, neck) * 0.62,
      neck,
      hip,
      shL: neck,
      shR: neck,
      hipL: hip,
      hipR: hip,
      elL: P(j.l_elbow),
      elR: P(j.r_elbow),
      knL: P(j.l_knee),
      knR: P(j.r_knee),
      LH: P(j.lh),
      RH: P(j.rh),
      LF: P(j.lf),
      RF: P(j.rf),
    };
  });
  const num = new Map(o.route.map((h, i) => [h.id, String(i + 1).padStart(2, "0")]));
  const last = poses.length - 1;

  // Same words the voice coach uses (coach/coachTools.js), when it can describe the move.
  const coachSays = (i: number) => {
    if (!o.req) return null;
    try {
      const d = describeMove(o.req, res, i, o.holdTypes);
      return d?.say ? d.say.charAt(0).toLowerCase() + d.say.slice(1) : null;
    } catch {
      return null;
    }
  };
  const moves = res.moves.map((m, i): BetaMove => {
    const hold = m.hold === null ? undefined : o.byId.get(m.hold);
    if (!hold) {
      const who = LIMB_NAME[m.limb];
      const at = poses[Math.min(i + 1, last)][m.limb];
      let text = `${who.toLowerCase()} smears on the wall.`;
      if (i === res.crux) text += " This is the crux.";
      return { limb: m.limb, hold: null, at, label: "WALL", text: coachSays(i) ?? text, fall: m.fall_chance, effort: m.effort };
    }
    const label = num.get(hold.id) ?? hold.tag;
    const who = LIMB_NAME[m.limb].toLowerCase();
    const type = hold.type === "foot" ? "foot hold" : TYPE_INFO[hold.type].name.toLowerCase();
    const before = poses[Math.min(i, last)];
    const matched = dist(before[OTHER[m.limb]], hold) < Math.max(hold.r * 1.6, 24);
    const isHand = m.limb === "LH" || m.limb === "RH";
    let text = matched
      ? `${who} matches on the ${type}, hold ${label}.`
      : `${who} ${isHand ? "to" : "up to"} the ${type}, hold ${label}.`;
    if (!matched && m.span_m >= 0.3) text += ` Reach ${m.span_m.toFixed(2)} m.`;
    if (i === res.crux) text += " This is the crux.";
    return { limb: m.limb, hold, at: hold, label, text: coachSays(i) ?? text, fall: m.fall_chance, effort: m.effort };
  });

  return {
    moves,
    crux: res.crux + 1,
    grade: { font: res.grade.font, v: res.grade.v, range: `Range ${res.grade.low} to ${res.grade.high}` },
    route: o.route,
    others: o.others,
    start: (o.req?.start ?? []).map((n) => o.byId.get(n)?.id).filter((x): x is string => !!x),
    finish: (o.req?.finish ?? []).map((n) => o.byId.get(n)?.id).filter((x): x is string => !!x),
    colour: o.colour,
    aspect: o.aspect,
    unitsPerMetre: (1000 * o.aspect) / o.wallH,
    finishChance: res.physics?.finish_chance,
    loadsAt: (k) => {
      const f = res.keyframes[Math.max(0, Math.min(last, Math.round(k)))]?.physics?.forces;
      if (!f?.length) return null;
      const out = { LH: 0, RH: 0, LF: 0, RF: 0 } as Record<Limb, number>;
      for (const x of f) out[x.limb] = x.share;
      return out;
    },
    poseAt: (t) => {
      const i = Math.max(0, Math.min(last, Math.floor(t)));
      const j = Math.min(last, i + 1);
      const f = ease(Math.max(0, Math.min(1, t - i)));
      const a = poses[i];
      const b = poses[j];
      const out = { ...a, headR: a.headR + (b.headR - a.headR) * f } as Pose;
      for (const key of Object.keys(a) as (keyof Pose)[])
        if (key !== "headR") (out[key] as Pt) = lerp(a[key] as Pt, b[key] as Pt, f);
      return out;
    },
  };
}
