// Upload dropzone art: a setter's ink sketch of a wall panel showing what
// BetaCrux does to a photo. Taped start holds, a dashed beta line to the TOP,
// and the app's own stick figure mid-move. Hand-plotted paths plus a small
// displacement filter on the background ink give it a drawn-by-hand wobble;
// text, tape and the climber stay crisp.

import { useId, type ReactNode } from "react";
import { C } from "../lib/wall";
import { BODY, DETAIL, type PinKind } from "./HoldPins";

const FONT_TAG = "Barlow Semi Condensed";
const FONT_HAND = "Barlow Condensed";

type Pt = [number, number];

/* ---- the route, bottom to top ---- */
const A: Pt = [124, 262]; // start, left
const B: Pt = [180, 270]; // start, right
const H1: Pt = [108, 150];
const H2: Pt = [212, 124];
const H3: Pt = [264, 84];
const TOP: Pt = [236, 38];

/* ---- climber (feet on the starts, left hand on H1, right hand reaching for H2) ---- */
// Leaning into the reach: hips under the left hand, head turned to the target.
const NECK: Pt = [157, 176];
const BODYPTS = {
  head: [164, 158] as Pt,
  hip: [144, 220] as Pt,
  lh: [111, 149] as Pt,
  lEl: [124, 186] as Pt,
  rh: [200, 134] as Pt,
  rEl: [188, 168] as Pt,
  lKn: [108, 236] as Pt,
  lf: [125, 259] as Pt,
  rKn: [186, 244] as Pt,
  rf: [178, 266] as Pt,
};

/* holds drawn on the panel: [kind, x, y, size, rotate, on the route] */
const HOLDS: [PinKind, number, number, number, number, boolean][] = [
  ["jug", ...A, 30, -8, true],
  ["sloper", ...B, 32, 6, true],
  ["crimp", ...H1, 30, -12, true],
  ["pinch", ...H2, 28, 14, true],
  ["jug", ...H3, 30, 18, true],
  ["jug", ...TOP, 32, -4, true],
  // off route
  ["sloper", 70, 66, 30, 0, false],
  ["crimp", 160, 56, 26, -8, false],
  ["pinch", 302, 204, 26, -20, false],
  ["jug", 356, 242, 30, 12, false],
  ["crimp", 66, 232, 22, 6, false],
  ["crimp", 342, 104, 22, 32, false], // on the volume
];
const CHIPS: Pt[] = [
  [200, 220],
  [262, 252],
  [92, 108],
  [318, 130],
  [372, 168],
  [40, 290],
];

function near(x: number, y: number, d: number) {
  return (
    HOLDS.some(([, hx, hy]) => Math.hypot(hx - x, hy - y) < d) ||
    CHIPS.some(([cx, cy]) => Math.hypot(cx - x, cy - y) < d * 0.6)
  );
}

function Hold({
  kind,
  x,
  y,
  s,
  r,
  route,
}: {
  kind: PinKind;
  x: number;
  y: number;
  s: number;
  r: number;
  route: boolean;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s / 64}) translate(-32 -32)`}>
      <path
        d={BODY[kind]}
        fill={route ? C.yellow : C.surface}
        fillOpacity={route ? 0.5 : 1}
        stroke={C.ink}
        strokeOpacity={route ? 0.85 : 0.45}
        strokeWidth={1.3}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={DETAIL[kind]}
        fill="none"
        stroke={C.ink}
        strokeOpacity={route ? 0.45 : 0.28}
        strokeWidth={1}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={33} cy={33} r={3.4} fill={C.surface} stroke={C.ink} strokeOpacity={0.6} strokeWidth={0.9} vectorEffect="non-scaling-stroke" />
    </g>
  );
}

/** Gym tape: a strip with torn ends and a label. */
function Tape({ x, y, r, text, colour, w = 26 }: { x: number; y: number; r: number; text: string; colour: string; w?: number }) {
  const h = 13;
  const torn = (sx: number, dir: 1 | -1) =>
    [0, 1, 2, 3, 4].map((i) => `${sx + (i % 2 ? 2.2 * dir : 0)},${-h / 2 + (i * h) / 4}`).join(" ");
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <polygon
        points={`${torn(-w / 2, -1)} ${torn(w / 2, 1).split(" ").reverse().join(" ")}`}
        fill={colour}
        opacity={0.92}
      />
      <text
        y={3.6}
        textAnchor="middle"
        fill={C.surface}
        fontFamily={FONT_TAG}
        fontSize={10}
        fontWeight={600}
        letterSpacing={1.3}
      >
        {text}
      </text>
    </g>
  );
}

function Badge({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={7.5} fill={C.ink} />
      <text x={x} y={y + 3.4} textAnchor="middle" fill={C.surface} fontFamily={FONT_TAG} fontSize={10} fontWeight={600}>
        {n}
      </text>
    </g>
  );
}

const line = (a: Pt, b: Pt, k: string): ReactNode => <line key={k} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;

function Climber() {
  const p = BODYPTS;
  const bonesStill = [
    line(NECK, p.hip, "spine"),
    line(p.head, NECK, "neck"),
    line(NECK, p.lEl, "ual"),
    line(p.lEl, p.lh, "fal"),
    line(p.hip, p.lKn, "thl"),
    line(p.lKn, p.lf, "shl"),
    line(p.hip, p.rKn, "thr"),
    line(p.rKn, p.rf, "shr"),
  ];
  const arm = [line(NECK, p.rEl, "uar"), line(p.rEl, p.rh, "far")];
  const joints = (pts: Pt[]) =>
    pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3.6} fill={C.accent} stroke={C.ink} strokeWidth={1.2} />);
  return (
    <g data-name="sketch/climber" strokeLinecap="round">
      <g stroke={C.surface} strokeWidth={7}>{bonesStill}</g>
      <g stroke={C.ink} strokeWidth={3}>{bonesStill}</g>
      <g className="anim-reach" style={{ transformOrigin: `${NECK[0]}px ${NECK[1]}px` }}>
        <g stroke={C.surface} strokeWidth={7}>{arm}</g>
        <g stroke={C.ink} strokeWidth={3}>{arm}</g>
        {joints([p.rEl])}
        <circle cx={p.rh[0]} cy={p.rh[1]} r={5} fill={C.accent} stroke={C.surface} strokeWidth={2} />
      </g>
      <circle cx={p.head[0]} cy={p.head[1]} r={10} fill={C.surface} stroke={C.ink} strokeWidth={2.6} />
      {joints([NECK, p.lEl, p.hip, p.lKn, p.rKn])}
      {[p.lh, p.lf, p.rf].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={5} fill={C.accent} stroke={C.surface} strokeWidth={2} />
      ))}
    </g>
  );
}

export function WallSketch() {
  const id = useId().replace(/:/g, "");
  const wobble = `wob-${id}`;
  const soft = `soft-${id}`;
  const hatch = `hatch-${id}`;
  const reveal = `reveal-${id}`;

  const bolts: Pt[] = [];
  // The panel runs past the viewBox so wider boxes ("meet" fit) still fill edge to edge.
  for (let x = -54; x < 460; x += 34)
    for (let y = 20; y < 400; y += 34) {
      const onVolume = x > 285 && y < 152;
      if (!onVolume && !near(x, y, 24)) bolts.push([x, y]);
    }

  const beta = `M${A} C 96 222, 90 182, ${H1} S 178 118, ${H2} S 262 110, ${H3} S 244 54, ${TOP}`;

  return (
    <svg
      data-name="upload/wall-drawing"
      viewBox="0 0 400 440"
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 h-full w-full overflow-visible"
      aria-hidden
    >
      <defs>
        <filter id={wobble} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" />
          <feDisplacementMap in="SourceGraphic" scale="2.6" />
        </filter>
        <filter id={soft} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id={`${soft}-hand`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
        <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
          <line x1="0" y1="0" x2="0" y2="5" stroke={C.ink} strokeOpacity="0.22" strokeWidth="1" />
        </pattern>
        <mask id={reveal}>
          <path d={beta} pathLength={100} fill="none" stroke="#fff" strokeWidth={8} className="anim-draw" />
        </mask>
      </defs>

      {/* ---- panel: seams, grain, kicker, mat, T-nuts ---- */}
      <g filter={`url(#${wobble})`} fill="none" stroke={C.ink}>
        <path d="M234 0 C 232 110, 236 230, 233 440" strokeOpacity={0.22} />
        <path d="M-60 181 C 110 177, 280 183, 460 178" strokeOpacity={0.22} />
        <path d="M-60 301 C 140 300, 260 306, 460 304" strokeOpacity={0.3} />
        <path d="M-60 311 L 460 317" strokeOpacity={0.15} />
        <g strokeOpacity={0.08}>
          <path d="M52 24 C 90 30, 130 18, 220 26" />
          <path d="M50 44 C 100 52, 150 36, 222 46" />
          <path d="M60 92 C 110 98, 170 84, 224 94" />
          <path d="M48 128 C 96 136, 160 120, 226 130" />
          <path d="M246 214 C 300 220, 340 208, 398 216" />
          <path d="M248 270 C 290 276, 350 262, 398 270" />
        </g>
        <g strokeOpacity={0.28} strokeWidth={1}>
          {bolts.map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={2.2} />
          ))}
        </g>
      </g>
      <g data-name="sketch/mat">
        <rect x={-64} y={404} width={528} height={60} fill={C.hairline} fillOpacity={0.55} />
        <path d="M-60 404 L460 404" stroke={C.ink} strokeOpacity={0.35} />
        <path d="M134 404 L130 440 M268 404 L272 440" stroke={C.ink} strokeOpacity={0.18} strokeDasharray="3 4" />
      </g>

      {/* ---- chalk: smudges on the holds people grab, one handprint ---- */}
      <g filter={`url(#${soft})`} fill={C.hairline}>
        <ellipse cx={H1[0] + 6} cy={H1[1] - 10} rx={16} ry={9} opacity={0.8} />
        <ellipse cx={H2[0] - 4} cy={H2[1] - 12} rx={15} ry={8} opacity={0.75} />
        <ellipse cx={TOP[0]} cy={TOP[1] - 12} rx={18} ry={9} opacity={0.75} />
      </g>

      <g filter={`url(#${soft}-hand)`} fill={C.hairline}>
        <g transform="translate(330 268) rotate(-18)" opacity={0.95}>
          <ellipse cx={0} cy={0} rx={10} ry={12} />
          {[-9, -3, 3, 9].map((dx, i) => (
            <ellipse key={dx} cx={dx} cy={-16 - (i === 1 || i === 2 ? 3 : 0)} rx={2.6} ry={6} />
          ))}
          <ellipse cx={-13} cy={-1} rx={2.6} ry={5.5} transform="rotate(-40 -13 -1)" />
        </g>
      </g>

      {/* ---- volume, top right ---- */}
      <g data-name="sketch/volume" filter={`url(#${wobble})`} stroke={C.ink} strokeOpacity={0.6} strokeLinejoin="round">
        <polygon points="290,22 324,86 394,98" fill={C.surface} />
        <polygon points="394,98 324,86 300,150" fill={C.hairline} fillOpacity={0.7} />
        <polygon points="394,98 324,86 300,150" fill={`url(#${hatch})`} stroke="none" />
        <polygon points="300,150 324,86 290,22" fill={C.hairline} fillOpacity={0.35} />
        <circle cx={326} cy={92} r={2.4} fill={C.surface} />
      </g>

      {/* ---- holds ---- */}
      <g filter={`url(#${wobble})`}>
        {HOLDS.map(([kind, x, y, s, r, route], i) => (
          <Hold key={i} kind={kind} x={x} y={y} s={s} r={r} route={route} />
        ))}
        {CHIPS.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={3.6} fill={C.surface} stroke={C.ink} strokeOpacity={0.45} />
        ))}
      </g>

      {/* ---- setter tape ---- */}
      <Tape x={96} y={276} r={-10} text="S" colour={C.green} w={20} />
      <Tape x={208} y={284} r={8} text="S" colour={C.green} w={20} />
      <Tape x={276} y={36} r={-6} text="TOP" colour={C.ink} w={36} />

      {/* ---- beta line, inked in on load ---- */}
      <g mask={`url(#${reveal})`}>
        <path d={beta} fill="none" stroke={C.surface} strokeWidth={5} strokeOpacity={0.8} strokeLinecap="round" />
        <path
          d={beta}
          fill="none"
          stroke={C.accent}
          strokeWidth={2.2}
          strokeDasharray="5 6"
          strokeLinecap="round"
        />
      </g>
      <Badge x={H1[0] - 24} y={H1[1] - 6} n={1} />
      <Badge x={H2[0] + 20} y={H2[1] + 16} n={2} />
      <Badge x={H3[0] + 22} y={H3[1] + 8} n={3} />

      {/* grip ring on the hold the climber is going for */}
      <circle cx={H2[0]} cy={H2[1]} r={17} fill="none" stroke={C.accent} strokeWidth={2} />
      <circle
        cx={H2[0]}
        cy={H2[1]}
        r={17}
        fill="none"
        stroke={C.accent}
        strokeWidth={2}
        className="anim-ring"
        style={{ transformOrigin: `${H2[0]}px ${H2[1]}px` }}
      />

      <Climber />

      {/* ---- pencil margin notes ---- */}
      <g data-name="sketch/grade-note" transform="translate(352 186) rotate(-8)">
        <text textAnchor="middle" y={8} fill={C.ink} fillOpacity={0.75} fontFamily={FONT_HAND} fontSize={24} fontWeight={700}>
          V?
        </text>
        <path
          d="M-20 -2 C -20 -16, 18 -18, 21 -2 C 23 14, -14 18, -21 6 C -23 0, -18 -10, -8 -14"
          fill="none"
          stroke={C.ink}
          strokeOpacity={0.5}
          strokeWidth={1.3}
          strokeLinecap="round"
        />
      </g>
      <g data-name="sketch/scale" stroke={C.ink} strokeOpacity={0.5} filter={`url(#${wobble})`}>
        <line x1={24} y1={30} x2={24} y2={400} />
        {Array.from({ length: 9 }, (_, i) => {
          const y = 400 - (i * 370) / 8;
          const w = i % 2 === 0 ? 7 : 4;
          return <line key={i} x1={24 - w} y1={y} x2={24 + w} y2={y} />;
        })}
      </g>
      <text
        transform="translate(42 150) rotate(-90)"
        fill={C.muted}
        textAnchor="middle"
        fontFamily={FONT_TAG}
        fontSize={11}
        fontWeight={500}
        letterSpacing={1.3}
      >
        4.0 M
      </text>
    </svg>
  );
}
