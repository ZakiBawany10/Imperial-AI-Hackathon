import { useEffect } from "react";
import { C, HOLDS, betaFor, holdPath, type Hold } from "../lib/wall";
import {
  Btn,
  Glyph,
  Slider,
  HoldShape,
  MONO,
  MeasureLine,
  Screen,
  StickyBar,
  TopBar,
  WallPhoto,
} from "../ui/kit";

export type Angle = "slab" | "vertical" | "10" | "30";
export const ANGLES: { k: Angle; label: string; deg: number }[] = [
  { k: "slab", label: "Slab", deg: -12 },
  { k: "vertical", label: "Vertical", deg: 0 },
  { k: "10", label: "10°", deg: 10 },
  { k: "30", label: "30°+", deg: 30 },
];

const MOCK_ROUTE = HOLDS.filter((h) => h.colour === "blue").sort((a, b) => b.y - a.y);
const MOCK_OTHERS = HOLDS.filter((h) => h.colour !== "blue");

/** Route holds numbered bottom to top, the rest of the wall faded. */
export function RouteOverlay({
  strokeWidth = 3,
  route = MOCK_ROUTE,
  others = MOCK_OTHERS,
}: {
  strokeWidth?: number;
  route?: Hold[];
  others?: Hold[];
}) {
  return (
    <>
      {others.map((h) => (
        <HoldShape key={h.id} hold={h} opacity={0.22} strokeWidth={0.75} />
      ))}
      {route.map((h, i) => (
        <g key={h.id}>
          <path
            d={holdPath(h, 1.15)}
            fill="none"
            stroke={C.accent}
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
          <HoldShape hold={h} strokeWidth={1} />
          <text
            x={h.x + h.r * (h.sx ?? 1) + 12}
            y={h.y + 9}
            fill={C.surface}
            stroke={C.ink}
            strokeWidth={5}
            paintOrder="stroke"
            fontSize={26}
            fontFamily="Barlow Semi Condensed"
            fontWeight={500}
            letterSpacing={1}
          >
            {String(i + 1).padStart(2, "0")}
          </text>
        </g>
      ))}
    </>
  );
}

type Props = {
  photo: string;
  height: number;
  setHeight: (n: number) => void;
  wallH: number;
  setWallH: (n: number) => void;
  angle: Angle;
  setAngle: (a: Angle) => void;
  solving?: boolean;
  onSolve?: () => void;
  onCancel?: () => void;
  /** Board only: leave the solving frame after a fixed delay. */
  onSolved?: () => void;
  /** The real route from Review; without it the design mock is shown. */
  route?: Hold[];
  others?: Hold[];
  colour?: string;
  aspect?: number;
  /** /solve failed: message for the user */
  error?: string | null;
  /** offered when the server is unreachable */
  onExample?: () => void;
};

export function RouteScreen(p: Props) {
  const route = p.route ?? MOCK_ROUTE;
  if (p.solving)
    return <Solving {...p} route={route} />;
  const mockMoves = p.route ? null : betaFor(p.height).moves.length;
  return (
    <Screen name="screen/3-route">
      <TopBar step={3} />
      <div data-name="route/photo" className="relative h-[40%] shrink-0">
        <WallPhoto photo={p.photo} dim={0.45} aspect={p.aspect}>
          <RouteOverlay route={route} others={p.others} />
        </WallPhoto>
        <MeasureLine metres={p.wallH} />
        <span className={`${MONO} absolute top-3 right-3 rounded-[4px] bg-surface px-2 py-1`}>
          {route.length} holds · {p.colour ?? "blue"}
        </span>
      </div>

      <div data-name="route/form" className="min-h-0 flex-1 overflow-y-auto bg-surface">
        <section data-name="form/height" className="border-b border-hairline px-6 pt-6 pb-6">
          <div className="flex items-baseline justify-between">
            <label htmlFor="height" className={`${MONO} text-muted`}>
              Your height
            </label>
            {mockMoves !== null && <span className={`${MONO} text-muted`}>{mockMoves} moves</span>}
          </div>
          <p
            data-name="height/readout"
            className="mt-2 font-mono text-[56px] leading-none font-medium tracking-[0.005em]"
          >
            {p.height.toFixed(2)}
            <span className="ml-2 text-[20px] text-muted">m</span>
          </p>
          <div className="mt-4">
            <Slider
              id="height"
              label="Your height"
              min={1.4}
              max={2}
              step={0.01}
              value={p.height}
              onChange={p.setHeight}
            />
          </div>
          <div className={`${MONO} mt-1 flex justify-between text-muted`}>
            <span>1.40 m</span>
            <span>2.00 m</span>
          </div>
          <p className={`${MONO} mt-4 flex items-center gap-2 text-ink`}>
            <span className="size-1.5 rounded-full bg-tape-blue" aria-hidden />
            Reach is estimated from this
          </p>
        </section>

        <section data-name="form/wall-height" className="border-b border-hairline px-6 py-6">
          <p className={`${MONO} text-muted`}>Wall height in the photo</p>
          <div
            data-name="wall-height/stepper"
            className="mt-4 flex h-14 items-stretch overflow-hidden rounded-[6px] border border-ink"
          >
            <button
              aria-label="Decrease wall height"
              onClick={() => p.setWallH(Math.max(2, +(p.wallH - 0.1).toFixed(1)))}
              className="flex w-14 items-center justify-center bg-paper active:bg-hairline"
            >
              <Glyph kind="minus" />
            </button>
            <output className="flex flex-1 items-center justify-center border-x border-ink font-mono text-[20px] font-medium">
              {p.wallH.toFixed(1)} m
            </output>
            <button
              aria-label="Increase wall height"
              onClick={() => p.setWallH(Math.min(6, +(p.wallH + 0.1).toFixed(1)))}
              className="flex w-14 items-center justify-center bg-paper active:bg-hairline"
            >
              <Glyph kind="plus" />
            </button>
          </div>
          <p className="mt-3 text-[14px] leading-[1.45] text-muted">
            How tall is the part of the wall you photographed? Used to turn pixels into metres.
          </p>
        </section>

        <section data-name="form/wall-angle" className="px-6 py-6">
          <p className={`${MONO} text-muted`}>Wall angle</p>
          <div
            data-name="wall-angle/segmented"
            role="radiogroup"
            className="mt-4 grid grid-cols-4 overflow-hidden rounded-[6px] border border-ink"
          >
            {ANGLES.map((a, i) => {
              const on = p.angle === a.k;
              return (
                <button
                  key={a.k}
                  role="radio"
                  aria-checked={on}
                  onClick={() => p.setAngle(a.k)}
                  className={`flex h-[72px] flex-col items-center justify-center gap-1 ${i ? "border-l border-ink" : ""} ${on ? "bg-ink text-surface" : "bg-paper text-ink active:bg-hairline"}`}
                >
                  <AngleSketch deg={a.deg} />
                  <span className="text-[14px] font-semibold">{a.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <StickyBar>
        <Btn className="w-full" onClick={p.onSolve}>
          Solve route
        </Btn>
      </StickyBar>
    </Screen>
  );
}

function AngleSketch({ deg }: { deg: number }) {
  const rad = (deg * Math.PI) / 180;
  const L = 22;
  // wall rises from the floor at x=22; positive deg leans over the climber (towards -x)
  const x2 = 22 - Math.sin(rad) * L;
  const y2 = 28 - Math.cos(rad) * L;
  return (
    <svg viewBox="0 0 36 32" className="h-6 w-8" aria-hidden>
      <line x1="4" y1="28" x2="32" y2="28" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <line
        x1="22"
        y1="28"
        x2={x2}
        y2={y2}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Solving({
  photo,
  height,
  wallH,
  aspect,
  route,
  others,
  error,
  onCancel,
  onSolved,
  onExample,
}: Props & { route: Hold[] }) {
  useEffect(() => {
    if (!onSolved) return;
    const t = setTimeout(onSolved, 3600);
    return () => clearTimeout(t);
  }, [onSolved]);
  // No sequence yet: trace the route bottom to top while the solver works.
  const path = route.map((h, i) => `${i ? "L" : "M"}${h.x} ${h.y}`).join(" ");
  return (
    <Screen name="screen/3-solving">
      <TopBar step={3} />
      <div data-name="solving/photo" className="relative min-h-0 flex-1">
        <WallPhoto photo={photo} dim={0.45} aspect={aspect}>
          <RouteOverlay strokeWidth={2} route={route} others={others} />
          <path
            d={path}
            fill="none"
            stroke={C.surface}
            strokeOpacity={0.5}
            strokeWidth={8}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {!error && (
            <path
              data-name="solving/trace"
              d={path}
              pathLength={100}
              fill="none"
              stroke={C.accent}
              strokeWidth={5}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="anim-trace"
            />
          )}
        </WallPhoto>
        <MeasureLine metres={wallH} />
      </div>
      <StickyBar>
        {error ? (
          <div data-name="solving/error" role="alert">
            <p className={`${MONO} flex items-center gap-2 pt-2 text-accent`}>
              <span className="inline-block size-1.5 rounded-full bg-accent" aria-hidden />
              Couldn't solve this route
            </p>
            <p className="mt-2 text-[16px] leading-[1.4]">{error}</p>
            <div className={`mt-4 grid gap-3 ${onExample ? "grid-cols-2" : ""}`}>
              <Btn variant="outline" onClick={onCancel}>
                Back
              </Btn>
              {onExample && <Btn onClick={onExample}>Use example</Btn>}
            </div>
          </div>
        ) : (
          <>
            <p
              data-name="solving/caption"
              className={`${MONO} flex h-14 items-center gap-2`}
              aria-live="polite"
            >
              <span className="anim-blink inline-block size-1.5 rounded-full bg-accent" aria-hidden />
              Solving the best sequence...
            </p>
            <div className="mt-1 flex items-center justify-between">
              <span className={`${MONO} text-muted`}>{height.toFixed(2)} m climber</span>
              <Btn variant="text" size="md" className="-mr-2 px-2" onClick={onCancel}>
                Cancel
              </Btn>
            </div>
          </>
        )}
      </StickyBar>
    </Screen>
  );
}
