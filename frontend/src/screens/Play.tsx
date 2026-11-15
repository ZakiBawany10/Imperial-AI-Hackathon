import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { C, TYPE_INFO, betaFor, type Limb, type Pt } from "../lib/wall";
import { LIMB_NAME, mockBeta, type BetaView, type Pose } from "../lib/beta";
import type { Coach } from "../lib/coach";
import { openCamera, track, type Body, type ClimbEvent } from "../lib/tracker";
import { Btn, Flame, Glyph, Slider, MONO, Screen, StickyBar, TopBar, WallPhoto } from "../ui/kit";
import { RouteOverlay, StrengthPicker } from "./Route";
import { API_URL, HEIGHT_RANGE, type SolveRequest, type SolveResponse } from "../lib/api";

type Props = {
  photo: string;
  height: number;
  setHeight: (n: number) => void;
  wallH: number;
  angle: string;
  initialMove?: number;
  onNewWall?: () => void;
  onLive?: (move: number) => void;
  /** Real /solve answer; without it the design mock for `height` is shown. */
  beta?: BetaView;
  /** a re-solve for a new height is in flight */
  resolving?: boolean;
  /** the last re-solve failed */
  solveError?: string | null;
  /** grip strength (1.0 = regular); with setStrength, Play shows the picker */
  strength?: number;
  setStrength?: (s: number) => void;
  /** Real flow: draw the climb with the backend's 3D viewer (backend/demo/viewer). */
  viewer?: Viewer3DInput;
};

export type Viewer3DInput = {
  imageUrl: string;
  analyze: unknown;
  reliefUrl: string | null;
  req: SolveRequest;
  res: SolveResponse;
};
type MountedViewer = {
  play(): void;
  pause(): void;
  seek(i: number, o?: { animate?: boolean }): void;
  setSpeed(x: number): void;
  setSolve(req: unknown, res: unknown): void;
  on(ev: string, fn: (i: number) => void): () => void;
  dispose(): void;
  resize(): void;
  resetView(): void;
  setMesh(on: boolean): void;
};

/** Krishna's 3D viewer, loaded from the API server (contract: CLAUDE.md section 6).
 *  Our controls drive it (hud off). Status "failed" means use the 2D drawing. */
function useViewer3D(input: Viewer3DInput | undefined, box: React.RefObject<HTMLDivElement | null>) {
  const [status, setStatus] = useState<"off" | "loading" | "ready" | "failed">(input ? "loading" : "off");
  const ref = useRef<MountedViewer | null>(null);
  const handlers = useRef<{ move?: (i: number) => void; end?: () => void }>({});
  useEffect(() => {
    if (!input || !box.current) return;
    let gone = false;
    setStatus("loading");
    const url = `${API_URL}/demo/viewer/betacrux-viewer.js`;
    import(/* @vite-ignore */ url)
      .then((mod: { mountViewer: (el: HTMLElement, o: Record<string, unknown>) => MountedViewer }) => {
        if (gone || !box.current) return;
        const v = mod.mountViewer(box.current, {
          imageUrl: input.imageUrl,
          reliefUrl: input.reliefUrl ?? undefined,
          analyze: input.analyze,
          solveRequest: input.req,
          solve: input.res,
          theme: "paper",
          mesh: true,
          hud: false,
          autoplay: false,
          loop: false,
        });
        ref.current = v;
        v.on("move", (i) => handlers.current.move?.(i));
        v.on("end", () => handlers.current.end?.());
        v.seek(0, { animate: false });
        setStatus("ready");
      })
      .catch(() => !gone && setStatus("failed"));
    return () => {
      gone = true;
      ref.current?.dispose();
      ref.current = null;
    };
    // a new photo or relief map needs a fresh scene; a new solve uses setSolve below
  }, [input?.imageUrl, input?.reliefUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (input && ref.current) ref.current.setSolve(input.req, input.res);
  }, [input?.req, input?.res]); // eslint-disable-line react-hooks/exhaustive-deps
  return { status, viewer: ref, handlers };
}

/** The mock beta changes only when the height crosses a band, so memo on that. */
function useBeta(beta: BetaView | undefined, height: number, wallH: number, angle: string) {
  const band = betaFor(height).band;
  const mock = useMemo(
    () => (beta ? null : mockBeta(height, wallH, angle)),
    [beta, band, wallH, angle], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return beta ?? mock!;
}

/* ---- the climber: a person seen from behind (they face the wall) ----
   Shirt, trousers, skin and hair over the same pose the solver gives. Widths
   scale with the torso, so the body keeps its proportions at any height. */
const SKIN = "#E3BE9C";
const HAIR = "#3B3027";

type V = { x: number; y: number };
const sub = (a: V, b: V) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: V) => Math.hypot(a.x, a.y) || 1;
const at = (a: V, u: V, k: number) => ({ x: a.x + u.x * k, y: a.y + u.y * k });

function Limb({ pts, w, fill }: { pts: V[]; w: number; fill: string }) {
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  return (
    <>
      <path d={d} fill="none" stroke={C.ink} strokeWidth={w + 3.2} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={fill} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

export function Climber({
  pose: sk,
  activeLimb,
  trail,
}: {
  pose: Pose;
  activeLimb?: Limb;
  trail?: Pt[];
}) {
  // body frame from the spine
  const spine = sub(sk.neck, sk.hip);
  const T = len(spine);
  const up = { x: spine.x / T, y: spine.y / T };
  const side = { x: -up.y, y: up.x }; // towards the climber's right as we look at their back
  const flip = side.x < 0 ? -1 : 1;
  const r = { x: side.x * flip, y: side.y * flip };
  const shL = at(sk.neck, r, -0.36 * T);
  const shR = at(sk.neck, r, 0.36 * T);
  const hipL = at(sk.hip, r, -0.2 * T);
  const hipR = at(sk.hip, r, 0.2 * T);
  const waist = 0.26 * T;
  const torso = [
    at(shL, up, -0.02 * T),
    at(shR, up, -0.02 * T),
    at(at(sk.hip, r, waist), up, 0.12 * T),
    at(at(sk.hip, r, -waist), up, 0.12 * T),
  ];
  const head = sk.head;
  const headR = 0.25 * T;
  const neckTop = at(sk.neck, up, 0.16 * T);
  const grip = activeLimb ? sk[activeLimb] : null;
  const w = { upper: 0.17 * T, fore: 0.14 * T, thigh: 0.25 * T, shin: 0.19 * T };
  const hand = (p: V) => <circle cx={p.x} cy={p.y} r={0.085 * T} fill={SKIN} stroke={C.ink} strokeWidth={1.6} />;
  const shoe = (p: V, knee: V) => {
    const u = sub(p, knee);
    const a = (Math.atan2(u.y, u.x) * 180) / Math.PI - 90;
    return (
      <ellipse cx={p.x} cy={p.y} rx={0.11 * T} ry={0.16 * T} transform={`rotate(${a} ${p.x} ${p.y})`} fill={C.ink} stroke={C.surface} strokeWidth={1.2} />
    );
  };
  return (
    <g data-name="play/skeleton">
      {trail && trail.length > 1 && (
        <polyline
          points={trail.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={C.surface}
          strokeOpacity={0.7}
          strokeWidth={4}
          strokeDasharray="2 10"
          strokeLinecap="round"
        />
      )}
      {/* soft shadow on the wall behind the body */}
      <ellipse
        cx={(sk.neck.x + sk.hip.x) / 2}
        cy={(sk.neck.y + sk.hip.y) / 2}
        rx={0.6 * T}
        ry={0.9 * T}
        fill={C.ink}
        opacity={0.18}
        style={{ filter: "blur(6px)" }}
      />
      {grip && (
        <g data-name="play/grip-ring">
          <circle cx={grip.x} cy={grip.y} r={0.42 * T} fill={C.accent} fillOpacity={0.18} />
          <circle
            cx={grip.x}
            cy={grip.y}
            r={0.36 * T}
            fill="none"
            stroke={C.surface}
            strokeWidth={3}
            className="anim-ring"
            style={{ transformOrigin: `${grip.x}px ${grip.y}px` }}
          />
          <circle cx={grip.x} cy={grip.y} r={0.3 * T} fill="none" stroke={C.accent} strokeWidth={3.5} />
        </g>
      )}
      {/* legs, then torso, then arms and head on top */}
      <Limb pts={[hipL, sk.knL, sk.LF]} w={w.thigh} fill={C.ink} />
      <Limb pts={[hipR, sk.knR, sk.RF]} w={w.thigh} fill={C.ink} />
      {shoe(sk.LF, sk.knL)}
      {shoe(sk.RF, sk.knR)}
      <path
        d={`M${torso.map((p) => `${p.x} ${p.y}`).join(" L")} Z`}
        fill={C.accent}
        stroke={C.ink}
        strokeWidth={2.6}
        strokeLinejoin="round"
      />
      {/* waistband */}
      <path
        d={`M${torso[3].x} ${torso[3].y} L${torso[2].x} ${torso[2].y}`}
        stroke={C.ink}
        strokeWidth={0.1 * T}
        strokeLinecap="round"
      />
      <Limb pts={[shL, sk.elL, sk.LH]} w={w.upper} fill={SKIN} />
      <Limb pts={[shR, sk.elR, sk.RH]} w={w.upper} fill={SKIN} />
      {/* short sleeves */}
      <Limb pts={[shL, at(shL, sub(sk.elL, shL), 0.35)]} w={w.upper + 3} fill={C.accent} />
      <Limb pts={[shR, at(shR, sub(sk.elR, shR), 0.35)]} w={w.upper + 3} fill={C.accent} />
      {hand(sk.LH)}
      {hand(sk.RH)}
      <Limb pts={[sk.neck, neckTop]} w={0.13 * T} fill={SKIN} />
      <circle cx={head.x} cy={head.y} r={headR} fill={HAIR} stroke={C.ink} strokeWidth={2.4} />
      <path
        d={`M${head.x - headR * 0.55} ${head.y - headR * 0.35} Q${head.x} ${head.y - headR * 0.85} ${head.x + headR * 0.55} ${head.y - headR * 0.35}`}
        fill="none"
        stroke={C.surface}
        strokeOpacity={0.35}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </g>
  );
}

export function PlayScreen({
  photo,
  height,
  setHeight,
  wallH,
  angle,
  initialMove = 4,
  onNewWall,
  onLive,
  beta: real,
  resolving,
  solveError,
  strength,
  setStrength,
  viewer: viewerInput,
}: Props) {
  const beta = useBeta(real, height, wallH, angle);
  const stage = useRef<HTMLDivElement>(null);
  const v3d = useViewer3D(viewerInput, stage);
  const in3d = v3d.status === "ready";
  const [meshOn, setMeshOn] = useState(true);
  useEffect(() => setMeshOn(true), [viewerInput?.reliefUrl]); // a new relief map mounts a fresh viewer, mesh on
  const toggleMesh = () => {
    v3d.viewer.current?.setMesh(!meshOn);
    setMeshOn(!meshOn);
  };
  const n = beta.moves.length;
  const g = beta.grade;
  const [t, setT] = useState(Math.min(initialMove, n));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 0.5>(1);
  const raf = useRef(0);

  useEffect(() => setT((v) => Math.min(v, n)), [n]);
  useEffect(() => {
    v3d.handlers.current = {
      move: (i) => setT(i + 0.5),
      end: () => {
        setT(n);
        setPlaying(false);
      },
    };
  });
  useEffect(() => {
    if (!in3d) return;
    const v = v3d.viewer.current!;
    v.setSpeed(speed);
    if (playing) v.play();
    else v.pause();
  }, [in3d, playing, speed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing || in3d) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setT((v) => {
        const nv = v + (dt / 1300) * speed;
        if (nv >= n) {
          setPlaying(false);
          return n;
        }
        return nv;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed, n]);

  const move = Math.max(1, Math.min(n, Math.ceil(t - 0.001)));
  const m = beta.moves[move - 1];
  const active = m.limb;
  const trail = Array.from({ length: move + 1 - Math.max(0, move - 3) }, (_, i) =>
    beta.poseAt(Math.max(0, move - 3) + i)[active],
  );
  const loads = beta.loadsAt?.(t) ?? null;
  const go = (k: number) => {
    setPlaying(false);
    const kk = Math.max(0, Math.min(n, k));
    setT(kk);
    // 3D: play move k (ends in the pose after it); move 0 = the start position
    if (in3d) v3d.viewer.current!.seek(Math.max(0, kk - 1), { animate: kk > 0 });
  };

  return (
    <Screen name="screen/4-play">
      <TopBar step={4} />
      <div data-name="play/photo" className="relative h-[calc(58%-var(--sat)*0.42-74px)] shrink-0">
        {/* Krishna's 3D viewer when it loads; the 2D drawing underneath otherwise */}
        {viewerInput && v3d.status !== "failed" && (
          <div
            ref={stage}
            data-name="play/3d"
            className={`absolute inset-0 z-[1] bg-paper transition-opacity duration-300 ${in3d ? "opacity-100" : "opacity-0"}`}
          />
        )}
        <WallPhoto photo={photo} dim={0.3} aspect={beta.aspect}>
          <RouteOverlay
            strokeWidth={1.5}
            route={beta.route}
            others={beta.others}
            start={beta.start}
            finish={beta.finish}
            tags
          />
          {/* where the moving limb is going: pulsing rings on the next hold */}
          {t < n && (
            <g data-name="play/next-hold" pointerEvents="none">
              {[0, 0.8].map((d) => (
                <circle
                  key={d}
                  cx={m.at.x}
                  cy={m.at.y}
                  r={(m.hold?.r ?? 14) * 1.3 + 14}
                  fill="none"
                  stroke={C.surface}
                  strokeWidth={3}
                  className="anim-ring"
                  style={{ transformOrigin: `${m.at.x}px ${m.at.y}px`, animationDelay: `${d}s` }}
                />
              ))}
            </g>
          )}
          <Climber pose={beta.poseAt(t)} activeLimb={active} trail={trail} />
        </WallPhoto>
        <span className={`${MONO} absolute top-3 left-3 z-[2] rounded-[4px] bg-surface px-2 py-1`}>
          {height.toFixed(2)} m · {wallH.toFixed(1)} m wall
        </span>
        {in3d && (
          <div data-name="play/3d-controls" className="absolute top-3 right-3 z-[2] flex gap-1.5">
            {viewerInput?.reliefUrl && (
              <button
                onClick={toggleMesh}
                title="The wall's 3D shape from the photo, or a flat wall with raised holds"
                className={`${MONO} rounded-[4px] border border-ink px-2 py-1 ${meshOn ? "bg-ink text-surface" : "bg-surface"}`}
              >
                3D wall {meshOn ? "on" : "off"}
              </button>
            )}
            <button
              onClick={() => v3d.viewer.current?.resetView()}
              title="Put the camera back"
              className={`${MONO} rounded-[4px] border border-ink bg-surface px-2 py-1 active:bg-ink active:text-surface`}
            >
              Reset view
            </button>
          </div>
        )}
      </div>

      <div data-name="play/scroll" className="relative z-10 -mt-6 min-h-0 flex-1 overflow-y-auto">
        <div
          data-name="play/grade-card"
          className="mx-4 flex items-stretch rounded-[4px] border border-ink bg-surface"
        >
          <div className="flex items-baseline gap-2 border-r border-hairline px-4 py-2">
            <span
              data-name="grade/font"
              className="font-mono text-[56px] leading-none font-medium tracking-[0.005em]"
            >
              {g.font}
            </span>
            <span data-name="grade/v" className="font-mono text-[20px] font-medium text-muted">
              {g.v}
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-2 px-4">
            <span className={`${MONO} text-muted`}>{g.range}</span>
            <button
              onClick={() => go(beta.crux)}
              className={`${MONO} inline-flex h-7 items-center gap-1.5 self-start rounded-[3px] border border-accent px-2 text-accent-ink active:bg-accent active:text-surface`}
            >
              <Flame /> Crux: move {beta.crux}
            </button>
          </div>
        </div>

        <div data-name="play/timeline" className="mt-2 px-6" role="tablist" aria-label="Moves">
          <div className="flex h-6 items-end justify-between">
            {beta.moves.map((_, i) => {
              const k = i + 1;
              const cur = k === move;
              const crux = k === beta.crux;
              return (
                <button
                  key={k}
                  role="tab"
                  aria-selected={cur}
                  aria-label={`Move ${k}`}
                  onClick={() => go(k)}
                  className="relative -mt-6 flex h-12 w-7 flex-col items-center justify-end"
                >
                  {crux && <Flame className="absolute top-3 size-3" />}
                  <span
                    className={`w-[3px] ${crux ? "h-5" : "h-3"} ${cur ? "bg-accent" : k < move ? "bg-ink" : "bg-hairline"}`}
                  />
                </button>
              );
            })}
          </div>
          <div className="flex justify-between border-t border-ink pt-1">
            {beta.moves.map((_, i) => (
              <span
                key={i}
                className={`w-7 text-center font-mono text-[12px] font-medium ${i + 1 === move ? "text-accent-ink" : "text-muted"}`}
              >
                {i + 1}
              </span>
            ))}
          </div>
          <p
            data-name="play/move-text"
            className="mt-2 min-h-[44px] text-[16px] leading-[1.4]"
            aria-live="polite"
          >
            <span className="font-semibold">
              Move {move} of {n}:
            </span>{" "}
            {m.text}
          </p>
          {m.effort != null && (
            <div data-name="play/effort" className="mt-3">
              <div className="flex items-baseline justify-between">
                <span className={`${MONO} text-[11px] text-muted`}>Effort</span>
                <span className={`text-[12px] ${m.effort >= 0.82 ? "text-alert" : "text-muted"}`}>
                  {m.effort >= 1
                    ? "Too hard to hold at this strength"
                    : `${Math.round(m.effort * 100)}% of full grip strength`}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hairline">
                <div
                  className={`h-full rounded-full ${m.effort >= 0.82 ? "bg-alert" : "bg-accent"}`}
                  style={{ width: `${Math.min(100, Math.round(m.effort * 100))}%`, transition: "width 400ms ease" }}
                />
              </div>
            </div>
          )}
          {(m.fall != null || beta.finishChance != null) && (
            <p data-name="play/risk" className={`${MONO} mt-2 flex flex-wrap gap-x-4 text-muted`}>
              {m.fall != null && (
                <span className={m.fall >= 0.2 ? "text-alert" : ""}>
                  {Math.round(m.fall * 100)}% fall chance
                </span>
              )}
              {beta.finishChance != null && (
                <span>{Math.round(beta.finishChance * 100)}% chance to top</span>
              )}
            </p>
          )}
          {loads && (
            <div data-name="play/weight" className="mt-3">
              <p className={`${MONO} text-[11px] text-muted`}>Weight on</p>
              <div className="mt-1.5 grid grid-cols-4 gap-3">
                {(["LH", "RH", "LF", "RF"] as const).map((l) => {
                  const pct = Math.round(loads[l] * 100);
                  return (
                    <div key={l} data-name={`weight/${l}`}>
                      <div className="flex items-baseline justify-between">
                        <span className="text-[12px] text-muted">{WEIGHT_LABEL[l]}</span>
                        <span className="font-mono text-[12px] font-medium">{pct}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hairline">
                        <div
                          className={`h-full rounded-full ${l === active ? "bg-accent-ink" : "bg-accent"}`}
                          style={{ width: `${pct}%`, transition: "width 400ms ease" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div data-name="play/height" className="mt-4 border-t border-hairline px-6 pt-4 pb-4">
          <div className="flex items-baseline justify-between">
            <label htmlFor="play-height" className={`${MONO} text-muted`}>
              Climber
            </label>
            <span className="font-mono text-[20px] font-medium">{height.toFixed(2)} m</span>
          </div>
          <div className="mt-2">
            <Slider
              id="play-height"
              label="Climber height"
              compact
              min={HEIGHT_RANGE[0]}
              max={HEIGHT_RANGE[1]}
              step={0.01}
              value={height}
              onChange={setHeight}
            />
          </div>
          {setStrength && <StrengthPicker compact value={strength ?? 1} onChange={setStrength} />}
          <p
            data-name="play/height-status"
            className={`${MONO} mt-2 ${solveError ? "text-alert" : "text-muted"}`}
            aria-live="polite"
          >
            {resolving
              ? "Solving for this climber..."
              : solveError
                ? solveError
                : "Change height or strength: the climb re-solves"}
          </p>
        </div>
      </div>

      <StickyBar>
        <div data-name="play/controls" className="-mt-1 mb-2 flex items-center justify-between">
          <button
            aria-label="Previous move"
            onClick={() => go(Math.ceil(t - 0.001) - 1)}
            className="flex size-12 items-center justify-center rounded-[6px] border border-ink active:bg-ink active:text-surface"
          >
            <Glyph kind="prev" />
          </button>
          <button
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => {
              if (!playing && t >= n) setT(0);
              setPlaying(!playing);
            }}
            className="flex size-16 items-center justify-center rounded-full bg-ink text-surface active:bg-accent"
          >
            <Glyph kind={playing ? "pause" : "play"} className="size-6" />
          </button>
          <button
            aria-label="Next move"
            onClick={() => go(Math.floor(t + 0.001) + 1)}
            className="flex size-12 items-center justify-center rounded-[6px] border border-ink active:bg-ink active:text-surface"
          >
            <Glyph kind="next" />
          </button>
          <button
            aria-label="Playback speed"
            onClick={() => setSpeed(speed === 1 ? 0.5 : 1)}
            className={`${MONO} flex h-12 w-16 items-center justify-center rounded-[6px] border border-hairline`}
          >
            {speed === 1 ? "1x" : "0.5x"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Btn variant="outline" onClick={onNewWall}>
            New wall
          </Btn>
          <Btn onClick={() => onLive?.(move)}>Live mode</Btn>
        </div>
      </StickyBar>
    </Screen>
  );
}

const WEIGHT_LABEL = { LH: "L hand", RH: "R hand", LF: "L foot", RF: "R foot" } as const;

export type Voice = "idle" | "listening" | "speaking";

export function LiveScreen({
  photo,
  height,
  wallH,
  voice: initialVoice = "idle",
  move = 4,
  onExit,
  beta: real,
  coach,
  onMove,
  onRecorded,
  similar,
}: {
  photo: string;
  height: number;
  wallH: number;
  voice?: Voice;
  move?: number;
  onExit?: () => void;
  /** the live camera saw a move done (or the user skipped one): the next move, 1-based */
  onMove?: (move: number) => void;
  /** the camera stopped after following a climb: save it (returns a note to show) */
  onRecorded?: (r: { events: ClimbEvent[]; topped: boolean; source: "camera" | "video" }) => Promise<string>;
  /** what people did on similar routes before (from stored climbs) */
  similar?: string | null;
  beta?: BetaView;
  /** the real ElevenLabs coach; without it the button cycles the design states */
  coach?: Coach;
}) {
  const beta = useBeta(real, height, wallH, "vertical");
  const n = beta.moves.length;
  const k = Math.max(1, Math.min(move, n));
  const [voice, setVoice] = useState<Voice>(initialVoice);
  const m = beta.moves[k - 1];
  const hand = m.limb;
  const target = m.at;
  const wrist = beta.poseAt(k - 1)[hand];
  const cm = Math.round((Math.hypot(target.x - wrist.x, target.y - wrist.y) / beta.unitsPerMetre) * 100);
  const text = m.text.charAt(0).toUpperCase() + m.text.slice(1);
  const who = LIMB_NAME[hand];
  const kind = m.hold && m.hold.type !== "foot" ? TYPE_INFO[m.hold.type].name.toLowerCase() + " " : "";
  const cue = m.hold ? `${who} to ${kind}${m.label}` : `${who} smears on the wall`;

  /* ---- live camera: the phone films the climber from where it took the photo ---- */
  const [cam, setCam] = useState<"off" | "starting" | "on">("off");
  const [camNote, setCamNote] = useState<string | null>(null);
  const [ghost, setGhost] = useState(true);
  const [body, setBody] = useState<Body | null>(null);
  const [topped, setTopped] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stopCam = useRef<(() => void) | null>(null);
  const tracker = useRef<{ stop: () => void; setDone: (n: number) => void; events: () => ClimbEvent[] } | null>(null);
  const [file, setFile] = useState<File | null>(null); // a filmed climb instead of the live camera
  const fileInput = useRef<HTMLInputElement>(null);
  const toppedRef = useRef(false);
  const moveRef = useRef(k);
  moveRef.current = k;
  const closeCam = () => {
    const t = tracker.current;
    if (t && onRecorded) {
      const events = t.events();
      if (events.length >= 3)
        onRecorded({ events, topped: toppedRef.current, source: file ? "video" : "camera" })
          .then((msg) => setCamNote(msg))
          .catch(() => setCamNote("Could not save this climb."));
    }
    tracker.current?.stop();
    stopCam.current?.();
    tracker.current = stopCam.current = null;
    setCam("off");
    setBody(null);
  };
  useEffect(() => {
    if (cam !== "starting" || !video.current) return;
    let gone = false;
    (async () => {
      try {
        if (file) {
          const v = video.current!, url = URL.createObjectURL(file);
          v.srcObject = null;
          v.src = url;
          v.muted = true;
          v.playsInline = true;
          v.onended = () => closeCam();
          await v.play();
          stopCam.current = () => {
            v.pause();
            v.onended = null;
            v.removeAttribute("src");
            URL.revokeObjectURL(url);
          };
        } else stopCam.current = await openCamera(video.current!);
        if (gone) return stopCam.current();
        const t = await track(video.current!, {
          aspect: beta.aspect ?? 1,
          moves: beta.moves.map((mv) => ({
            limb: mv.limb,
            at: mv.at,
            r: (mv.hold?.r ?? 14) * 1.3 + 30,
            hasHold: !!mv.hold,
          })),
          done: moveRef.current - 1,
          onBody: setBody,
          holds: beta.route
            .filter((h) => /^h\d+$/.test(h.id))
            .map((h) => ({ id: Number(h.id.slice(1)), at: { x: h.x, y: h.y }, r: h.r * 1.3 + 30 })),
          onDone: (d) => {
            if (d >= n) {
              setTopped(true);
              toppedRef.current = true;
            }
            onMove?.(Math.min(d + 1, n));
          },
          onStatus: (msg) => setCamNote(msg || null),
        });
        if (gone) return t.stop();
        tracker.current = t;
        setCam("on");
      } catch (e) {
        setCamNote(
          e instanceof Error && e.name === "NotAllowedError"
            ? "Camera blocked. Allow the camera for this site and try again."
            : `Camera could not start: ${e instanceof Error ? e.message : e}`,
        );
        stopCam.current?.();
        setCam("off");
      }
    })();
    return () => {
      gone = true;
    };
  }, [cam]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => closeCam(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (d: number) => {
    const next = Math.max(1, Math.min(n, k + d));
    setTopped(false);
    tracker.current?.setDone(next - 1);
    onMove?.(next);
  };
  const live = cam !== "off";
  const mover = body ? (body[hand] as Pt) : null;
  const demoNext = () =>
    setVoice(voice === "idle" ? "listening" : voice === "listening" ? "speaking" : "idle");
  const st = coach?.status;
  const shown: Voice = coach ? (st === "speaking" ? "speaking" : st === "off" ? "idle" : "listening") : voice;
  const next = coach ? (st === "off" ? coach.start : coach.stop) : demoNext;
  const sub = coach
    ? st === "off"
      ? coach.available
        ? "Tap to talk"
        : "Tap to hear moves"
      : coach.mode !== "voice"
        ? "Reading moves"
      : st === "connecting"
        ? "Connecting"
        : st
    : voice === "idle"
      ? "Tap to talk"
      : voice;

  return (
    <Screen name="screen/4-live">
      <TopBar
        step={4}
        right={
          <Btn
            variant="text"
            size="md"
            className="-mr-2 px-2 font-mono text-[12px] tracking-[0.14em] uppercase"
            onClick={onExit}
          >
            <Glyph kind="close" className="size-4" /> Exit live
          </Btn>
        }
      />
      <div
        data-name="live/feed"
        className="relative h-[calc(70%-var(--sat)*0.3-74px)] shrink-0 bg-ink"
      >
        <WallPhoto
          photo={photo}
          name="live/camera"
          aspect={beta.aspect}
          under={
            live && (
              <>
                <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
                {ghost && (
                  <img src={photo} alt="" className="pointer-events-none absolute inset-0 h-full w-full opacity-35" />
                )}
              </>
            )
          }
        >
          {!live && <Climber pose={beta.poseAt(k - 1)} />}
          {live && body && (
            <g data-name="live/tracked-body" pointerEvents="none" stroke={C.surface} strokeWidth={5} strokeLinecap="round">
              <line x1={(body.shoulders[0].x + body.shoulders[1].x) / 2} y1={(body.shoulders[0].y + body.shoulders[1].y) / 2}
                    x2={(body.hips[0].x + body.hips[1].x) / 2} y2={(body.hips[0].y + body.hips[1].y) / 2} />
              {([[body.shoulders[0], body.lw, body.LH], [body.shoulders[1], body.rw, body.RH],
                 [body.hips[0], body.lh, body.LF], [body.hips[1], body.rh, body.RF]] as Pt[][]).map((seg, i) => (
                <polyline key={i} fill="none" points={seg.map((q) => `${q.x},${q.y}`).join(" ")} />
              ))}
              {(["LH", "RH", "LF", "RF"] as const).map((l) => (
                <circle key={l} cx={body[l].x} cy={body[l].y} r={l === hand ? 14 : 9}
                        fill={l === hand ? C.accent : C.surface} stroke={C.ink} strokeWidth={3} />
              ))}
            </g>
          )}
          {(!live || mover) && (
            <line
              x1={(mover ?? wrist).x}
              y1={(mover ?? wrist).y}
              x2={target.x}
              y2={target.y}
              stroke={C.surface}
              strokeWidth={3}
              strokeDasharray="10 8"
            />
          )}
          <g data-name="live/next-hold">
            <circle
              cx={target.x}
              cy={target.y}
              r={44}
              fill="none"
              stroke={C.accent}
              strokeWidth={5}
            />
            <circle
              cx={target.x}
              cy={target.y}
              r={56}
              fill="none"
              stroke={C.accent}
              strokeWidth={2}
              strokeOpacity={0.6}
              className="anim-ring"
              style={{ transformOrigin: `${target.x}px ${target.y}px` }}
            />
            <rect
              x={target.x + 52}
              y={target.y - 46}
              width={96}
              height={30}
              rx={3}
              fill={C.accent}
            />
            <text
              x={target.x + 100}
              y={target.y - 25}
              textAnchor="middle"
              fill={C.surface}
              fontSize={17}
              fontFamily="Barlow Semi Condensed"
              fontWeight={500}
              letterSpacing={1.5}
            >
              NEXT {m.label}
            </text>
          </g>
          {!live && <g data-name="live/wrist-point">
            <circle
              cx={wrist.x}
              cy={wrist.y}
              r={16}
              fill={C.surface}
              stroke={C.ink}
              strokeWidth={3}
            />
            <circle cx={wrist.x} cy={wrist.y} r={6} fill={C.ink} />
            <text
              x={wrist.x - 24}
              y={wrist.y + 44}
              fill={C.surface}
              fontSize={16}
              fontFamily="Barlow Semi Condensed"
              fontWeight={500}
              letterSpacing={1.5}
            >
              {hand === "LH" || hand === "RH" ? "WRIST" : "FOOT"} · {cm} CM
            </text>
          </g>}
        </WallPhoto>
        <div data-name="live/camera-controls" className="absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() =>
              live ? closeCam() : (setFile(null), setCamNote(null), (toppedRef.current = false), setTopped(false), setCam("starting"))
            }
            className={`${MONO} rounded-[4px] border border-ink px-2.5 py-1.5 ${live ? "bg-ink text-surface" : "bg-surface"}`}
          >
            {cam === "starting" ? "Starting…" : live ? (file ? "Stop video" : "Stop camera") : "Follow me with the camera"}
          </button>
          {!live && (
            <>
              <button
                onClick={() => fileInput.current?.click()}
                className={`${MONO} rounded-[4px] border border-ink bg-surface px-2.5 py-1.5`}
              >
                Use a filmed climb
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="video/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  setFile(f);
                  setCamNote(null);
                  toppedRef.current = false;
                  setTopped(false);
                  setCam("starting");
                }}
              />
            </>
          )}
          {live && (
            <>
              <button onClick={() => setGhost(!ghost)} className={`${MONO} rounded-[4px] border border-ink bg-surface px-2.5 py-1.5`}>
                {ghost ? "Lined up" : "Line up"}
              </button>
              <button onClick={() => step(-1)} className={`${MONO} rounded-[4px] border border-ink bg-surface px-2.5 py-1.5`} aria-label="Back one move">‹</button>
              <button onClick={() => step(1)} className={`${MONO} rounded-[4px] border border-ink bg-surface px-2.5 py-1.5`} aria-label="Move done">Done ›</button>
            </>
          )}
          {(camNote || (live && !body && cam === "on")) && (
            <span className={`${MONO} rounded-[4px] bg-ink/80 px-2 py-1 text-surface`}>
              {camNote ?? "Looking for you… stand in the picture"}
            </span>
          )}
          {topped && <span className={`${MONO} rounded-[4px] bg-accent px-2 py-1 text-surface`}>Topped it!</span>}
        </div>
        <div
          data-name="live/progress"
          className="absolute inset-x-0 top-0 z-10 bg-ink/80 px-4 py-2"
        >
          <div className="flex items-center justify-between">
            <span className={`${MONO} flex items-center gap-2 text-surface`}>
              <span className="anim-blink size-1.5 rounded-full bg-accent" /> Live
            </span>
            <span className={`${MONO} text-surface`}>
              Move {k} / {n}
            </span>
          </div>
          <div className="mt-2 flex gap-1">
            {beta.moves.map((_, i) => (
              <span
                key={i}
                className={`h-[3px] flex-1 ${i + 1 < k ? "bg-surface" : i + 1 === k ? "bg-accent" : "bg-surface/25"}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div
        data-name="live/next-move"
        className="flex min-h-0 flex-1 items-center gap-4 px-6"
        style={{ paddingBottom: "calc(var(--sab) + 8px)" }}
      >
        <div className="min-w-0 flex-1">
          <p className={`${MONO} text-muted`}>Next move</p>
          <p
            data-name="live/cue"
            className="mt-1 font-display text-[32px] leading-[1.02] font-bold tracking-[0.005em]"
          >
            {cue}
          </p>
          <p className="mt-2 text-[14px] leading-[1.4] text-muted">{text}</p>
          {similar && (
            <p data-name="live/similar" className="mt-2 text-[13px] leading-[1.4] text-muted">
              On a route like this before: {similar}
            </p>
          )}
          {coach?.error && (
            <p data-name="live/coach-note" role="status" className="mt-2 text-[13px] leading-[1.4] text-muted">
              {coach.error}
            </p>
          )}
          {coach && coach.status !== "off" && coach.mode !== "voice" && (
            <Btn variant="outline" size="md" name="live/coach-next" className="mt-3" onClick={coach.next}>
              Next move
            </Btn>
          )}
        </div>
        <button
          data-name={`voice-coach/${shown}`}
          onClick={next}
          aria-label={`Voice coach: ${shown}`}
          className="flex shrink-0 flex-col items-center gap-2"
        >
          <span className="relative flex size-20 items-center justify-center">
            {shown === "listening" && (
              <>
                <span className="anim-pulse absolute inset-0 rounded-full border-2 border-accent" />
                <span className="anim-pulse absolute inset-0 rounded-full border-2 border-accent [animation-delay:600ms]" />
              </>
            )}
            <span
              className={`relative flex size-20 items-center justify-center rounded-full ${shown === "idle" ? "border border-ink bg-surface text-ink" : shown === "listening" ? "bg-accent text-ink" : "bg-ink text-surface"}`}
            >
              {shown === "speaking" ? <Waveform /> : <Mic />}
            </span>
          </span>
          <span className={`${MONO} text-center leading-tight`}>
            Voice coach
            <span
              className={`block text-[12px] ${shown === "idle" ? "text-muted" : "text-accent-ink"}`}
            >
              {sub}
            </span>
          </span>
        </button>
      </div>
    </Screen>
  );
}

function Mic() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function Waveform() {
  const bars = [6, 14, 22, 12, 26, 16, 8, 18, 10];
  return (
    <span className="flex h-8 items-center gap-[3px]" aria-hidden>
      {bars.map((h, i) => (
        <span
          key={i}
          className="anim-wave w-[2px] bg-surface"
          style={{ height: h, animationDelay: `${i * 90}ms` }}
        />
      ))}
    </span>
  );
}
