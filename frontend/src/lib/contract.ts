// Adapter from the API contract (contract/*.json, see Documents/PLAN.md) to
// the hold model the screens draw. The contract files are read-only here.
//
// Overlay space: 1000 units wide, 1000 * (h / w) high, so one photo pixel is
// 1000 / image.w units. Screens keep their sizes in those units.

import holdTypesJson from "@contract/hold_types.json";
import type { SolveRequest } from "./api";
import { HOLD_COLOURS, HOLD_TYPES, type Hold, type HoldType } from "./wall";

export type ApiHold = {
  id: number;
  x: number; // centre, photo pixels
  y: number;
  w: number;
  h: number;
  type: string;
  quality: number;
  color: string;
  score: number;
  needs_review: boolean;
  suggestions: { type: string; p: number }[];
  /** index into Analyze.routes, null = groups with no other hold (contract/README.md) */
  route?: number | null;
  color_name?: string;
};
export type ApiRoute = { id: number; color: string; color_name: string; holds: number[] };
export type Analyze = { image: { w: number; h: number }; holds: ApiHold[]; routes?: ApiRoute[] };
export type ApiHoldType = {
  id: string;
  name: string;
  quality: number;
  description: string;
  image: string;
};

export const HOLD_DB = holdTypesJson as ApiHoldType[];

const isType = (t: string): t is HoldType =>
  t === "unknown" || (HOLD_TYPES as readonly string[]).includes(t);

/* ---- colour grouping ----
   The detector gives every hold its own hex, so "select every hold of that
   colour" needs groups: neutral greys, darks, and hue buckets. */
function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
const HUE_NAMES = ["red", "orange", "yellow", "lime", "green", "teal", "cyan", "blue", "indigo", "purple", "pink", "rose"];
function groupOf(hex: string): string {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  if (max < 0.25) return "black";
  if (s < 0.22) return max > 0.75 ? "white" : "grey";
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return HUE_NAMES[Math.round((h * 60) / 30) % 12];
}

export type Prepared = {
  photo: string;
  aspect: number;
  holds: Hold[];
  /** ids (in route-hold order of the detector) of holds needing review */
  unsure: string[];
  groups: Record<string, { hex: string; count: number }>;
  image: Analyze["image"];
  /** the /analyze answer as it came (the 3D viewer draws from it) */
  raw: Analyze;
  /** the detector's hold behind each overlay hold, by overlay id */
  api: Record<string, ApiHold>;
};

export function prepare(photo: string, a: Analyze): Prepared {
  const k = 1000 / a.image.w;
  const sums: Record<string, [number, number, number, number]> = {};
  const withGroup = a.holds.map((h) => {
    const g = groupOf(h.color);
    const c = rgb(h.color);
    const s = (sums[g] ??= [0, 0, 0, 0]);
    s[0] += c[0];
    s[1] += c[1];
    s[2] += c[2];
    s[3]++;
    return { h, g };
  });
  const groups: Prepared["groups"] = {};
  for (const [g, s] of Object.entries(sums)) {
    const hex = "#" + [0, 1, 2].map((i) => Math.round(s[i] / s[3]).toString(16).padStart(2, "0")).join("");
    groups[g] = { hex, count: s[3] };
    HOLD_COLOURS[g] = hex; // so screens can look the group up by name
  }
  const holds: Hold[] = withGroup.map(({ h, g }) => {
    const type: HoldType = isType(h.type) ? h.type : "unknown"; // "unknown" is always flagged below
    const r = (h.w * k) / 2;
    return {
      id: `h${h.id}`,
      x: h.x * k,
      y: h.y * k,
      r: Math.max(r, 3),
      sx: 1,
      sy: Math.min(3, Math.max(0.3, h.h / h.w)),
      colour: g,
      hex: groups[g].hex,
      own: h.color,
      type,
      tag: String(h.id),
      guesses: h.suggestions
        .filter((s): s is { type: HoldType; p: number } => isType(s.type))
        .map((s) => [s.type, Math.round(s.p * 100)] as [HoldType, number]),
    };
  });
  const unsure = a.holds
    .filter((h) => h.needs_review || h.type === "unknown")
    .map((h) => `h${h.id}`);
  const api = Object.fromEntries(a.holds.map((h) => [`h${h.id}`, h]));
  return { photo, aspect: a.image.h / a.image.w, holds, unsure, groups, image: a.image, raw: a, api };
}

/* ---- route selection ----
   The backend groups holds into routes (contract/README.md "Colours and
   routes"); tapping a hold selects its backend route. `selectRoute` below is
   only the fallback for an answer without routes or a hold the user added. */

/** Overlay ids of the tapped hold's backend route; [tapped] if the backend
 *  grouped it with nothing; null if there is no backend grouping to use. */
export function backendRoute(p: Prepared, tapped: Hold): string[] | null {
  const own = p.api[tapped.id];
  if (!own || !p.raw.routes || own.route === undefined) return null;
  // A tap can land on a stacked duplicate (e.g. a hold's shadow) that the
  // backend left alone: take the route of a hold it sits on.
  const same = (h: Hold) => Math.hypot(h.x - tapped.x, h.y - tapped.y) < Math.max(h.r, tapped.r) * 0.6;
  const route = own.route ?? p.holds.find((h) => same(h) && p.api[h.id]?.route != null)?.id;
  const r = typeof route === "string" ? p.api[route].route : route;
  if (r == null) return [tapped.id];
  const ids = p.holds.filter((h) => p.api[h.id]?.route === r).map((h) => h.id);
  return ids.includes(tapped.id) ? ids : [tapped.id, ...ids];
}

/* Fallback: holds of a close colour that link to the tapped one
   in a chain at climbing distances, minus duplicate detections.
   - Colour: white, cream and grey are one family (low saturation), matched on
     brightness; colours match on hue (within 18 deg), and must be clearly
     coloured and not in deep shadow.
   - Distance: a link is at most 24% of the photo's HEIGHT (about a metre on a
     4 m wall), vertical gaps counted at 0.6. Height tracks the wall, so this
     works for portrait close-ups and landscape wide shots alike; a fraction of
     the width broke routes on portrait photos. */
function hsv(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: h * 60, s: max ? d / max : 0, v: max };
}
const LINK = 0.24;
const V_WEIGHT = 0.6;
const HUE = 18;

/** `aspect` is photo height / width, so the photo is 1000 * aspect overlay units tall. */
export function selectRoute(holds: Hold[], tapped: Hold, aspect: number): string[] {
  const colourOf = (h: Hold) => hsv(h.own ?? h.hex ?? "#888888");
  // The detector can find one hold twice, e.g. a white hold and the dark shadow
  // under it. If the tap landed on a stack, take its colour from the brightest copy.
  const same = (a: Hold, b: Hold) => Math.hypot(a.x - b.x, a.y - b.y) < Math.max(a.r, b.r) * 0.6;
  const seed = holds
    .filter((h) => h === tapped || same(h, tapped))
    .reduce((best, h) => (colourOf(h).v > colourOf(best).v ? h : best), tapped);
  tapped = seed;
  const t = colourOf(tapped);
  const neutral = t.s < 0.3;
  const alike = (h: Hold) => {
    if (h === tapped) return true;
    const c = colourOf(h);
    if (neutral) return c.s < 0.32 && Math.abs(c.v - t.v) < 0.2;
    const dh = Math.abs(((c.h - t.h + 540) % 360) - 180);
    return c.s >= 0.3 && dh <= HUE && c.v >= Math.max(0.45, t.v * 0.6);
  };
  const pool = holds.filter(alike);
  const link = LINK * 1000 * aspect;
  const near = (a: Hold, b: Hold) => Math.hypot(a.x - b.x, (a.y - b.y) * V_WEIGHT) <= link;
  const picked = new Set<Hold>([tapped]);
  const queue = [tapped];
  while (queue.length) {
    const a = queue.pop()!;
    for (const b of pool) if (!picked.has(b) && near(a, b)) (picked.add(b), queue.push(b));
  }
  // The detector sometimes finds one hold two or three times: drop a hold whose
  // centre lies inside a bigger picked hold, or that sits on a same-size copy
  // that's brighter.
  const list = [...picked];
  const inside = (h: Hold, o: Hold) =>
    o !== h &&
    (o.r > h.r || (o.r === h.r && colourOf(o).v > colourOf(h).v)) &&
    Math.abs(o.x - h.x) < o.r * (o.sx ?? 1) &&
    Math.abs(o.y - h.y) < o.r * (o.sy ?? 1);
  return list.filter((h) => h === tapped || !list.some((o) => inside(h, o))).map((h) => h.id);
}

/** What Review hands on: the chosen route (bottom to top) and the user's answers. */
export type RoutePick = {
  colour: string;
  holds: Hold[];
  start: string[];
  finish: string[];
  confirmed: Record<string, HoldType>;
};

/** POST /solve body from a picked route (PLAN.md: set type, copy quality from
 *  the hold database, needs_review=false). Ids go back to the contract's ints;
 *  `byId` maps them to the overlay holds for drawing the answer. */
export function buildSolve(
  p: Prepared,
  pick: RoutePick,
  o: { height: number; wallH: number; angleDeg: number; strength: number },
  qualityOf: (type: string) => number,
): { req: SolveRequest; byId: Map<number, Hold> } {
  const k = 1000 / p.image.w;
  let next = Math.max(-1, ...Object.values(p.api).map((h) => h.id)) + 1;
  const byId = new Map<number, Hold>();
  const intId = new Map<string, number>();
  const holds = pick.holds.map((h): ApiHold => {
    const orig = p.api[h.id];
    const answer = pick.confirmed[h.id];
    const base: ApiHold = orig
      ? { ...orig }
      : {
          // added by the user on Review
          id: next++,
          x: Math.round(h.x / k),
          y: Math.round(h.y / k),
          w: Math.round((2 * h.r) / k),
          h: Math.round((2 * h.r) / k),
          type: h.type,
          quality: qualityOf(h.type),
          color: h.hex ?? HOLD_COLOURS[h.colour] ?? "#888888",
          score: 1,
          needs_review: false,
          suggestions: [],
        };
    if (answer) Object.assign(base, { type: answer, quality: qualityOf(answer), needs_review: false });
    byId.set(base.id, h);
    intId.set(h.id, base.id);
    return base;
  });
  const ids = (list: string[]) => list.map((id) => intId.get(id)).filter((n): n is number => n !== undefined);
  return {
    req: {
      image: p.image,
      holds,
      start: ids(pick.start),
      finish: ids(pick.finish),
      climber_height_m: +o.height.toFixed(2),
      strength: o.strength,
      wall_height_m: +o.wallH.toFixed(1),
      wall_angle_deg: o.angleDeg,
    },
    byId,
  };
}
