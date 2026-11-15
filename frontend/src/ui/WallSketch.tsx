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
  ["jug", 122, 230, 30, -6], // start
  ["crimp", 94, 176, 24, -10],
  ["pinch", 152, 134, 24, 12],
  ["sloper", 126, 88, 28, -4],
  ["jug", 178, 46, 28, 8], // top
];
const pt = (i: number): Pt => [ROUTE[i][1], ROUTE[i][2]];

/* other holds on the wall: [kind, x, y, size, rotate, colour, boxed by the detector] */
const OTHERS: [PinKind, number, number, number, number, string, boolean][] = [
  ["sloper", 236, 206, 34, 4, HC.yellow, true],
  ["jug", 60, 112, 26, -14, HC.blue, true],
  ["crimp", 216, 100, 22, 18, HC.purple, true],
  ["jug", 268, 146, 24, -8, HC.green, true],
  ["pinch", 334, 66, 22, 24, HC.white, false],
  ["crimp", 300, 250, 20, -12, HC.blue, false],
  ["crimp", 376, 286, 18, 6, HC.purple, false],
  ["jug", 362, 250, 24, 10, HC.yellow, false],
  ["sloper", 240, 58, 20, -6, HC.purple, true],
  ["pinch", 38, 190, 18, -20, HC.green, false],
];
const CHIPS: Pt[] = [
  [186, 180], [204, 262], [86, 222], [100, 136], [312, 230], [228, 154], [160, 96], [56, 150],
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

export function WallSketch() {
  const id = useId().replace(/:/g, "");
  const shade = `shade-${id}`;
  const drop = `drop-${id}`;
  const reveal = `reveal-${id}`;
  const vign = `vign-${id}`;

  const nuts: Pt[] = [];
  for (let x = -40; x < 440; x += 26)
    for (let y = 14; y < 300; y += 26) if (!near(x, y, 20) && !(x > 288 && y > 84 && y < 214 && x < 400)) nuts.push([x, y]);

  const [p0, p1, p2, p3, p4] = [0, 1, 2, 3, 4].map(pt);
  const beta = `M${p0} C 104 214, 88 196, ${p1} S 142 154, ${p2} S 120 108, ${p3} S 166 64, ${p4}`;

  return (
    <>
      <svg
        data-name="upload/wall-drawing"
        viewBox="0 0 400 340"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full overflow-visible"
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
          <mask id={reveal}>
            <path d={beta} pathLength={100} fill="none" stroke="#fff" strokeWidth={10} className="anim-draw" />
          </mask>
        </defs>

        {/* ---- wall: panel, seams, T-nuts, a volume, the mat ---- */}
        <rect x={-200} y={-200} width={800} height={740} fill={WALL} />
        <g stroke="#fff" strokeOpacity={0.07}>
          <line x1={200} y1={-200} x2={200} y2={300} />
          <line x1={-200} y1={160} x2={600} y2={160} />
        </g>
        <g fill="#fff" fillOpacity={0.09}>
          {nuts.map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={1.5} />
          ))}
        </g>
        <g data-name="sketch/volume" strokeLinejoin="round">
          <polygon points="300,96 392,84 352,150" fill={PLANE_LIT} />
          <polygon points="300,96 352,150 318,206" fill={PLANE_SHADE} />
          <polygon points="392,84 420,196 352,150" fill={WALL_DEEP} />
          <polygon points="352,150 420,196 318,206" fill={PLANE_SHADE} fillOpacity={0.7} />
          <path d="M300 96 L352 150 L392 84 M352 150 L318 206 M352 150 L420 196" fill="none" stroke="#fff" strokeOpacity={0.14} />
        </g>
        <rect x={-200} y={296} width={800} height={240} fill={WALL_DEEP} />
        <line x1={-200} y1={296} x2={600} y2={296} stroke="#fff" strokeOpacity={0.12} />
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
          <line x1={22} y1={24} x2={22} y2={296} />
          {Array.from({ length: 9 }, (_, i) => {
            const y = 296 - (i * 272) / 8;
            const w = i % 2 === 0 ? 6 : 3;
            return <line key={i} x1={22 - w} y1={y} x2={22 + w} y2={y} />;
          })}
        </g>
        <g transform="translate(22 126) rotate(-90)">
          <rect x={-20} y={-8} width={40} height={16} rx={1.5} fill={C.surface} />
          <text y={3.8} textAnchor="middle" fill={C.ink} fontFamily={FONT} fontSize={10} fontWeight={600} letterSpacing={1.2}>
            4.3 M
          </text>
        </g>

        <g data-name="sketch/chip" transform="translate(318 22)">
          <rect x={-58} y={-10} width={116} height={20} rx={2} fill={C.surface} />
          <circle cx={-46} cy={0} r={3.5} fill={HC.red} />
          <text x={4} y={3.8} textAnchor="middle" fill={C.ink} fontFamily={FONT} fontSize={10.5} fontWeight={600} letterSpacing={1.3}>
            5 HOLDS · RED
          </text>
        </g>

        <g data-name="sketch/grade" transform="translate(338 164)">
          <rect x={-38} y={-30} width={76} height={60} rx={2} fill={C.surface} />
          <text x={-28} y={-14} fill={C.muted} fontFamily={FONT} fontSize={8.5} fontWeight={600} letterSpacing={1.4}>
            GRADE
          </text>
          <text x={-29} y={18} fill={C.ink} fontFamily={FONT} fontSize={30} fontWeight={700}>
            V3
          </text>
          <text x={9} y={17} fill={C.muted} fontFamily={FONT} fontSize={10} fontWeight={600} letterSpacing={1}>
            6A+
          </text>
        </g>
      </svg>
      {/* a scan line sweeping the photo, as while holds are being found */}
      <span
        aria-hidden
        className="anim-scan pointer-events-none absolute inset-x-0 h-px bg-accent opacity-60 shadow-[0_0_12px_2px_rgba(124,169,130,0.55)]"
      />
    </>
  );
}
