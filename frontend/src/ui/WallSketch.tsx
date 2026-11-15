// Upload dropzone art: a flat illustration of what Ascend does to a wall photo,
// drawn in the same language as the screens that follow. A dark wall panel
// (the ink photo frame of Review / You), detected holds boxed in sage, a red
// climb outlined in white with numbered tags (Review), the height ruler (You)
// and a grade card (Play). Crisp vector, no hand-drawn wobble.

import { useId } from "react";
import { C } from "../lib/wall";
import { BODY, DETAIL, type PinKind } from "./HoldPins";

const FONT = "Barlow Semi Condensed";
type Pt = [number, number];

/* Wall tones, derived from ink. */
const WALL = "#2A463D";
const WALL_DEEP = "#1F362F";
const PLANE_LIT = "#35574D";
const PLANE_SHADE = "#1B2F29";

/* Gym hold colours: muted so the route reads first. */
const HC = {
  red: "#C8553D",
  blue: "#4672B0",
  purple: "#7B5CA6",
  yellow: "#D6AE42",
  green: "#4F9A5C",
  white: "#E8EDE6",
};

/* ---- the climb, bottom to top ---- */
const ROUTE: [PinKind, number, number, number, number][] = [
  ["jug", 104, 246, 30, -6], // start
  ["crimp", 74, 186, 24, -10],
  ["pinch", 134, 140, 24, 12],
  ["sloper", 106, 92, 28, -4],
  ["jug", 160, 46, 28, 8], // top
];
const pt = (i: number): Pt => [ROUTE[i][1], ROUTE[i][2]];

/* other holds on the wall: [kind, x, y, size, rotate, colour, boxed by the detector] */
const OTHERS: [PinKind, number, number, number, number, string, boolean][] = [
  ["sloper", 214, 214, 34, 4, HC.yellow, true],
  ["jug", 64, 128, 26, -14, HC.blue, true],
  ["crimp", 196, 104, 22, 18, HC.purple, true],
  ["jug", 226, 160, 24, -8, HC.green, true],
  ["pinch", 300, 70, 22, 24, HC.white, false],
  ["crimp", 266, 252, 20, -12, HC.blue, false],
  ["crimp", 334, 300, 18, 6, HC.purple, false],
  ["jug", 324, 240, 24, 10, HC.yellow, false],
  ["sloper", 222, 54, 20, -6, HC.purple, true],
  ["pinch", 54, 214, 18, -20, HC.green, false],
];
const CHIPS: Pt[] = [
  [166, 186], [180, 250], [60, 250], [86, 150], [290, 196], [178, 150], [146, 92], [52, 70],
];

const near = (x: number, y: number, d: number) =>
  [...ROUTE.map(([, hx, hy]) => [hx, hy]), ...OTHERS.map(([, hx, hy]) => [hx, hy]), ...CHIPS].some(
    ([hx, hy]) => Math.hypot(hx - x, hy - y) < d,
  );

function HoldArt({
  kind,
  x,
  y,
  s,
  r,
  fill,
  shade,
}: {
  kind: PinKind;
  x: number;
  y: number;
  s: number;
  r: number;
  fill: string;
  shade: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s / 64}) translate(-32 -32)`}>
      <path d={BODY[kind]} fill={fill} />
      <path d={BODY[kind]} fill={`url(#${shade})`} />
      <path d={DETAIL[kind]} fill="none" stroke="#000" strokeOpacity={0.18} strokeWidth={2.5} strokeLinecap="round" />
    </g>
  );
}

/** Corner brackets around a detected hold. */
function Box({ x, y, s, delay }: { x: number; y: number; s: number; delay: number }) {
  const h = s / 2 + 5;
  const a = 6;
  const d = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]
    .map(([sx, sy]) => `M${x + sx * h} ${y + sy * (h - a)} V${y + sy * h} H${x + sx * (h - a)}`)
    .join(" ");
  return (
    <path
      d={d}
      fill="none"
      stroke={C.accent}
      strokeWidth={1.6}
      strokeLinecap="round"
      className="anim-pop"
      style={{ transformOrigin: `${x}px ${y}px`, animationDelay: `${delay}ms` }}
    />
  );
}

/** Review's hold tag: a small label box, mono numerals. */
function Tag({ x, y, text, bg = C.surface, fg = C.ink }: { x: number; y: number; text: string; bg?: string; fg?: string }) {
  const w = 8 + text.length * 6.4;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y={-7.5} width={w} height={15} rx={1.5} fill={bg} />
      <text y={3.6} textAnchor="middle" fill={fg} fontFamily={FONT} fontSize={10} fontWeight={600} letterSpacing={1}>
        {text}
      </text>
    </g>
  );
}

/* ---- marker lettering ----
   Single-stroke glyphs plotted by hand (baseline y = 0, cap height 14), so the
   tape reads as a setter's marker, not a typeface. [width, path] */
const GLYPHS: Record<string, [number, string]> = {
  V: [9.5, "M0 -14.2 Q2.6 -6.5 4.7 0 Q6.4 -7.4 9.4 -14.6"],
  "3": [8.8, "M0.6 -12.6 Q3.8 -15.6 6.8 -12.8 Q8.2 -9.4 3.4 -7.6 Q8.6 -6.6 8 -2.6 Q6.2 1.2 0.8 -1.2"],
  "6": [8.8, "M7.2 -13.8 Q2.2 -13.2 1 -6.2 Q0.4 0.2 4.4 0.1 Q8.4 0 8.1 -4 Q7.6 -8.2 3.6 -7.2 Q1.6 -6.6 1 -4.8"],
  "5": [9, "M8.2 -14 L2.2 -13.6 L1.4 -7.8 Q5.6 -10.2 7.8 -6.6 Q9 -2 5 -0.3 Q2 0.6 0.5 -1.6"],
  a: [8.4, "M7 -7.4 Q3.6 -10.6 1.3 -6.1 Q0 -1 3.4 -0.4 Q6.4 0.1 7 -4.8 M7.1 -9.2 Q6.9 -4 7.4 0.4"],
  "+": [7.6, "M0.2 -5 Q3.6 -5.6 7.2 -5.2 M3.7 -8.8 Q3.5 -5 3.4 -1.4"],
  h: [8.2, "M1.1 -15 Q0.8 -7 1.2 0.2 M1.2 -5.8 Q3 -9.6 5.4 -9.1 Q7.3 -8.6 7.1 -4.8 L7.2 0.2"],
  o: [8.2, "M4 -9.1 Q0.5 -9 0.6 -4.4 Q0.8 0.1 4 0 Q7.5 -0.1 7.5 -4.6 Q7.3 -9.4 3.4 -8.8"],
  l: [3.4, "M1.6 -15.2 Q1 -7 1.7 0.2"],
  d: [8.8, "M7.1 -15.2 Q6.8 -7 7.3 0.3 M7 -5.8 Q6 -9.6 3.5 -9.1 Q0.5 -8.6 0.6 -4.2 Q0.8 0 3.8 -0.3 Q6.2 -0.6 7 -3"],
  s: [7.4, "M6.4 -8 Q4 -10.1 1.8 -8.3 Q0.4 -6.4 3.5 -5.1 Q7 -3.8 6.2 -1.5 Q4.4 0.9 0.8 -1"],
  " ": [4.5, ""],
};

/** A word in marker. `x` is the centre; each letter sits a little off the line. */
function Marker({ text, x, y, scale = 1, colour, weight = 2.3 }: { text: string; x: number; y: number; scale?: number; colour: string; weight?: number }) {
  const gap = 1.6;
  const width = [...text].reduce((w, ch) => w + (GLYPHS[ch]?.[0] ?? 6) + gap, -gap);
  let cx = -width / 2;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} fill="none" stroke={colour} strokeWidth={weight / scale} strokeLinecap="round" strokeLinejoin="round">
      {[...text].map((ch, i) => {
        const [w, d] = GLYPHS[ch] ?? [6, ""];
        const g = (
          <path key={i} d={d} transform={`translate(${cx} ${[0.4, -0.5, 0.2, -0.3, 0.6][i % 5]}) rotate(${[-3, 2, -1, 3, -2][i % 5]} ${w / 2} -7)`} />
        );
        cx += w + gap;
        return g;
      })}
    </g>
  );
}

/** A strip of tape stuck on the wall: torn ends, a sheen, a soft shadow. */
function TapeStrip({ w, h, colour, sheen = 0.18 }: { w: number; h: number; colour: string; sheen?: number }) {
  const torn = (sx: number, dir: 1 | -1) =>
    Array.from({ length: 7 }, (_, i) => `${sx + [0, 1.6, 0.4, 2, 0.6, 1.4, 0][i] * dir},${-h / 2 + (i * h) / 6}`);
  const pts = [...torn(-w / 2, -1), ...torn(w / 2, 1).reverse()].join(" ");
  return (
    <>
      <polygon points={pts} fill="#000" opacity={0.28} transform="translate(0.8 2)" />
      <polygon points={pts} fill={colour} />
      <rect x={-w / 2 + 2} y={-h / 2 + 2} width={w - 4} height={h * 0.28} fill="#fff" opacity={sheen} />
    </>
  );
}

export function WallSketch() {
  const id = useId().replace(/:/g, "");
  const shade = `shade-${id}`;
  const drop = `drop-${id}`;
  const reveal = `reveal-${id}`;
  const vign = `vign-${id}`;
  const marker = `marker-${id}`;

  const nuts: Pt[] = [];
  for (let x = -40; x < 440; x += 26)
    for (let y = 14; y < 380; y += 26) if (!near(x, y, 20) && !(x > 254 && y > 80 && y < 214)) nuts.push([x, y]);

  const [p0, p1, p2, p3, p4] = [0, 1, 2, 3, 4].map(pt);
  const beta = `M${p0} C 86 228, 70 208, ${p1} S 124 160, ${p2} S 100 114, ${p3} S 148 64, ${p4}`;

  return (
    <>
      <svg
        data-name="upload/wall-drawing"
        viewBox="0 0 360 360"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id={shade} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity={0.28} />
            <stop offset="0.45" stopColor="#fff" stopOpacity={0} />
            <stop offset="1" stopColor="#000" stopOpacity={0.32} />
          </linearGradient>
          <filter id={drop} x="-30%" y="-30%" width="160%" height="170%">
            <feDropShadow dx="0" dy="2.5" stdDeviation="1.8" floodColor="#000" floodOpacity="0.4" />
          </filter>
          <radialGradient id={vign} cx="0.4" cy="0.4" r="0.85">
            <stop offset="0.55" stopColor={WALL_DEEP} stopOpacity={0} />
            <stop offset="1" stopColor={WALL_DEEP} stopOpacity={0.9} />
          </radialGradient>
          {/* marker on tape: a slight wobble in the strokes and the torn edges */}
          <filter id={marker} x="-10%" y="-20%" width="120%" height="150%">
            <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="3" />
            <feDisplacementMap in="SourceGraphic" scale="1.4" />
          </filter>
          <mask id={reveal}>
            <path d={beta} pathLength={100} fill="none" stroke="#fff" strokeWidth={10} className="anim-draw" />
          </mask>
        </defs>

        {/* ---- wall: panel, seams, T-nuts, a volume, the mat ---- */}
        <rect x={-200} y={-200} width={800} height={740} fill={WALL} />
        <g stroke="#fff" strokeOpacity={0.07}>
          <line x1={180} y1={-200} x2={180} y2={560} />
          <line x1={-200} y1={168} x2={600} y2={168} />
        </g>
        <g fill="#fff" fillOpacity={0.09}>
          {nuts.map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={1.5} />
          ))}
        </g>
        <g data-name="sketch/volume" strokeLinejoin="round">
          <polygon points="262,92 354,80 314,146" fill={PLANE_LIT} />
          <polygon points="262,92 314,146 280,204" fill={PLANE_SHADE} />
          <polygon points="354,80 382,194 314,146" fill={WALL_DEEP} />
          <polygon points="314,146 382,194 280,204" fill={PLANE_SHADE} fillOpacity={0.7} />
          <path d="M262 92 L314 146 L354 80 M314 146 L280 204 M314 146 L382 194" fill="none" stroke="#fff" strokeOpacity={0.14} />
        </g>
        <rect x={-200} y={-200} width={800} height={740} fill={`url(#${vign})`} />

        {/* ---- holds ---- */}
        <g filter={`url(#${drop})`}>
          {OTHERS.map(([kind, x, y, s, r, colour], i) => (
            <HoldArt key={i} kind={kind} x={x} y={y} s={s} r={r} fill={colour} shade={shade} />
          ))}
          {CHIPS.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={3.2} fill={[HC.blue, HC.yellow, HC.purple, HC.green][i % 4]} />
          ))}
        </g>
        {/* the climb: white outline with a dark edge, as on Review */}
        <g>
          {ROUTE.map(([kind, x, y, s, r], i) => (
            <g key={i} transform={`translate(${x} ${y}) rotate(${r}) scale(${s / 64}) translate(-32 -32)`}>
              <path d={BODY[kind]} fill="none" stroke={C.ink} strokeWidth={9} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <path d={BODY[kind]} fill="none" stroke={C.surface} strokeWidth={6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </g>
        <g filter={`url(#${drop})`}>
          {ROUTE.map(([kind, x, y, s, r], i) => (
            <HoldArt key={i} kind={kind} x={x} y={y} s={s} r={r} fill={HC.red} shade={shade} />
          ))}
        </g>

        {/* ---- what the app found ---- */}
        {OTHERS.filter((o) => o[6]).map(([, x, y, s], i) => (
          <Box key={i} x={x} y={y} s={s} delay={200 + i * 140} />
        ))}

        {/* beta line, drawn in on load */}
        <g mask={`url(#${reveal})`}>
          <path d={beta} fill="none" stroke={C.surface} strokeWidth={1.6} strokeDasharray="4 5" strokeLinecap="round" strokeOpacity={0.9} />
        </g>

        {/* start ring (green) and finish ring */}
        <circle cx={p0[0]} cy={p0[1]} r={22} fill="none" stroke={C.accent} strokeWidth={2} />
        <circle
          cx={p0[0]}
          cy={p0[1]}
          r={22}
          fill="none"
          stroke={C.accent}
          strokeWidth={2}
          className="anim-ring"
          style={{ transformOrigin: `${p0[0]}px ${p0[1]}px` }}
        />
        <circle cx={p4[0]} cy={p4[1]} r={20} fill="none" stroke={C.surface} strokeWidth={1.5} strokeDasharray="3 3" />

        <Tag x={p0[0] - 48} y={p0[1] + 2} text="START" bg={C.accent} />
        <Tag x={p1[0] - 30} y={p1[1] - 2} text="02" />
        <Tag x={p2[0] + 30} y={p2[1] + 2} text="03" />
        <Tag x={p3[0] - 32} y={p3[1] + 2} text="04" />
        <Tag x={p4[0] + 36} y={p4[1] + 2} text="TOP" />

        {/* ---- HUD: height ruler (You), climb chip, grade card (Play) ---- */}
        <g data-name="sketch/scale" stroke={C.surface} strokeOpacity={0.7}>
          <line x1={32} y1={20} x2={32} y2={318} />
          {Array.from({ length: 9 }, (_, i) => {
            const y = 318 - (i * 298) / 8;
            const w = i % 2 === 0 ? 6 : 3;
            return <line key={i} x1={32 - w} y1={y} x2={32 + w} y2={y} />;
          })}
        </g>
        <g transform="translate(32 120) rotate(-90)">
          <rect x={-20} y={-8} width={40} height={16} rx={1.5} fill={C.surface} />
          <text y={3.8} textAnchor="middle" fill={C.ink} fontFamily={FONT} fontSize={10} fontWeight={600} letterSpacing={1.2}>
            4.3 M
          </text>
        </g>

        {/* ---- the setter's tape: route colour + hold count, and the grade ---- */}
        <g data-name="sketch/route-tape" transform="translate(284 30) rotate(-4)" filter={`url(#${marker})`}>
          <TapeStrip w={76} h={22} colour={HC.red} sheen={0.14} />
          <Marker text="5 holds" x={0} y={6} scale={0.9} colour="#FFF8EE" weight={2} />
        </g>

        <g data-name="sketch/grade-tape" transform="translate(298 156) rotate(5)" filter={`url(#${marker})`}>
          <TapeStrip w={80} h={40} colour="#E9DFC6" sheen={0.25} />
          <Marker text="V3" x={-13} y={12} scale={1.55} colour="#1E1E1C" weight={3.2} />
          <Marker text="6a+" x={20} y={11} scale={0.78} colour="#1E1E1C" weight={1.9} />
          <path d="M-30 15.5 Q-12 18.5 5 15" fill="none" stroke="#1E1E1C" strokeWidth={1.6} strokeLinecap="round" />
        </g>
      </svg>
      <ScanRead />
    </>
  );
}

/** The wall being read: a line passes top to bottom; below it the photo waits
 *  in shadow, above it the photo is lit. One pass, a pause, then again. Used
 *  on the drop zone and while holds are being found. */
export function ScanRead() {
  return (
    <>
      <span
        aria-hidden
        className="anim-read pointer-events-none absolute inset-x-0 bottom-0 bg-[rgba(10,22,18,0.5)] backdrop-saturate-[0.4]"
      />
      <span
        aria-hidden
        className="anim-read pointer-events-none absolute inset-x-0 h-[1.5px] bg-[#9FD3A9] shadow-[0_0_8px_2px_rgba(124,169,130,0.6)]"
      />
    </>
  );
}
