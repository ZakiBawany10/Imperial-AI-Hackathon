// Adapter from the API contract (contract/*.json, see Documents/PLAN.md) to
// the hold model the screens draw. The contract files are read-only here.
//
// Overlay space: 1000 units wide, 1000 * (h / w) high, so one photo pixel is
// 1000 / image.w units. Screens keep their sizes in those units.

import analyzeJson from "@contract/analyze.json";
import holdTypesJson from "@contract/hold_types.json";
import wallUrl from "@contract/wall.jpg";
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
};
export type Analyze = { image: { w: number; h: number }; holds: ApiHold[] };
export type ApiHoldType = {
  id: string;
  name: string;
  quality: number;
  description: string;
  image: string;
};

export const HOLD_DB = holdTypesJson as ApiHoldType[];
export const EXAMPLE_WALL = { photo: wallUrl, analyze: analyzeJson as Analyze };

const isType = (t: string): t is HoldType => (HOLD_TYPES as readonly string[]).includes(t);

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
    const type: HoldType = isType(h.type) ? h.type : "jug"; // "unknown" is always flagged below
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
  return { photo, aspect: a.image.h / a.image.w, holds, unsure, groups };
}
