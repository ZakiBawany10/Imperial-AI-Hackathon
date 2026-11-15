// Ascend logo: a geometric capital A (its apex a summit) between two raised,
// feathered wings. Drawn on a 512 x 512 grid.
// The same paths are in public/logo.svg, which the app icons are rendered from.

import { C } from "../lib/wall";

/** Capital A with its counter cut out (even-odd fill). */
export const A_PATH =
  "M256 96 L372 404 H316 L297 352 H215 L196 404 H140 Z M232 308 H280 L256 240 Z";

/** Left wing: one silhouette with a scalloped, feathered trailing edge. The right wing mirrors it. */
export const WING_PATH =
  "M234 242 C200 176 130 124 44 114 C70 148 98 168 126 182 C102 186 80 196 58 210 C94 222 120 234 140 246 C120 254 102 266 86 282 C132 290 172 314 208 348 Z";

/** `gap` is the background colour: a thin knockout keeps the A clear of the wings. */
export function LogoGlyph({
  letter = C.ink,
  wing = C.accent,
  gap = C.surface,
}: {
  letter?: string;
  wing?: string;
  gap?: string;
}) {
  return (
    <>
      <g fill={wing} stroke={wing} strokeWidth={8} strokeLinejoin="round">
        <path d={WING_PATH} />
        <path d={WING_PATH} transform="translate(512 0) scale(-1 1)" />
      </g>
      <path
        d={A_PATH}
        fill={letter}
        fillRule="evenodd"
        stroke={gap}
        strokeWidth={18}
        strokeLinejoin="round"
        paintOrder="stroke"
      />
    </>
  );
}

/** The mark alone, for the top bar: ink A, sage wings, no background. */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="40 90 432 330" width={(size * 432) / 330} height={size} className={className} aria-hidden>
      <LogoGlyph />
    </svg>
  );
}

/** The "d" of Ascend as a rock: a faceted boulder for the bowl, a climbing
 *  pocket for its counter, and the usual stem. Drawn on Josefin Sans' own
 *  metrics (units = 1/100 em, baseline at y = 0) so it sits in the word. */
function RockD() {
  return (
    <svg
      viewBox="0 -80 62.4 82"
      aria-hidden
      style={{ display: "inline-block", height: "0.82em", width: "0.624em", verticalAlign: "-0.02em", overflow: "visible" }}
    >
      <rect x={41.2} y={-78.9} width={14} height={78.9} rx={1} fill="currentColor" />
      <path
        d="M5 -2 L3.6 -20 L10.5 -37.5 L24 -46.5 L38.5 -44.5 L47 -35 L47 -6 L37 0.6 L14 1.2 Z
           M17.5 -27 L23 -34.5 L31.5 -33 L35 -24 L31 -13.5 L21.5 -12.5 Z"
        fill="currentColor"
        fillRule="evenodd"
        strokeLinejoin="round"
      />
      {/* one sage facet catching the light; the angular outline and pocket do the rest */}
      <path d="M10.5 -37.5 L17.5 -27" stroke={C.accent} strokeWidth={2.4} strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** The wordmark in the top bar: "Ascend" with its d drawn as a rock. */
export function Wordmark() {
  return (
    <span
      data-name="topbar/wordmark"
      role="img"
      aria-label="Ascend"
      className="font-josefin text-[23px] leading-none font-bold tracking-[0.02em] whitespace-nowrap text-ink"
    >
      <span aria-hidden>Ascen</span>
      <RockD />
    </span>
  );
}
