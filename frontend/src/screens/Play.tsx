import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { C, TYPE_INFO, betaFor, type Limb, type Pt } from "../lib/wall";
import { LIMB_NAME, mockBeta, type BetaView, type Pose } from "../lib/beta";
import { Btn, Flame, Glyph, Slider, MONO, Screen, StickyBar, TopBar, WallPhoto } from "../ui/kit";
import { RouteOverlay } from "./Route";

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
  /** the beta is the fixed contract example (server unreachable) */
  example?: boolean;
};

/** The mock beta changes only when the height crosses a band, so memo on that. */
function useBeta(beta: BetaView | undefined, height: number, wallH: number, angle: string) {
  const band = betaFor(height).band;
  const mock = useMemo(
    () => (beta ? null : mockBeta(height, wallH, angle)),
    [beta, band, wallH, angle], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return beta ?? mock!;
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
  const seg = (a: Pt, b: Pt, k: string) => <line key={k} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
  const joints: Pt[] = [sk.shL, sk.shR, sk.elL, sk.elR, sk.hip, sk.knL, sk.knR];
  const ends: Pt[] = [sk.LH, sk.RH, sk.LF, sk.RF];
  const grip = activeLimb ? sk[activeLimb] : null;
  return (
    <g data-name="play/skeleton">
      {trail && trail.length > 1 && (
        <polyline
          points={trail.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={C.accent}
          strokeOpacity={0.45}
          strokeWidth={4}
          strokeDasharray="2 10"
          strokeLinecap="round"
        />
      )}
      {grip && (
        <g data-name="play/grip-ring">
          <circle cx={grip.x} cy={grip.y} r={52} fill={C.accent} fillOpacity={0.12} />
          <circle
            cx={grip.x}
            cy={grip.y}
            r={40}
            fill="none"
            stroke={C.accent}
            strokeOpacity={0.35}
            strokeWidth={6}
            className="anim-ring"
            style={{ transformOrigin: `${grip.x}px ${grip.y}px` }}
          />
          <circle cx={grip.x} cy={grip.y} r={34} fill="none" stroke={C.accent} strokeWidth={4} />
        </g>
      )}
      <g stroke={C.surface} strokeWidth={9} strokeLinecap="round" opacity={0.9}>
        {bones(sk, seg)}
      </g>
      <g stroke={C.ink} strokeWidth={4.5} strokeLinecap="round">
        {bones(sk, seg)}
      </g>
      <circle
        cx={sk.head.x}
        cy={sk.head.y}
        r={sk.headR}
        fill={C.surface}
        stroke={C.ink}
        strokeWidth={4.5}
      />
      {joints.map((j, i) => (
        <circle key={i} cx={j.x} cy={j.y} r={7} fill={C.accent} stroke={C.ink} strokeWidth={2} />
      ))}
      {ends.map((j, i) => (
        <circle
          key={`e${i}`}
          cx={j.x}
          cy={j.y}
          r={10}
          fill={C.accent}
          stroke={C.surface}
          strokeWidth={3}
        />
      ))}
    </g>
  );
}
function bones(sk: Pose, seg: (a: Pt, b: Pt, k: string) => ReactNode) {
  return [
    seg(sk.neck, sk.hip, "spine"),
    seg(sk.shL, sk.shR, "sh"),
    seg(sk.hipL, sk.hipR, "hp"),
    seg(sk.shL, sk.elL, "ual"),
    seg(sk.elL, sk.LH, "fal"),
    seg(sk.shR, sk.elR, "uar"),
    seg(sk.elR, sk.RH, "far"),
    seg(sk.hipL, sk.knL, "thl"),
    seg(sk.knL, sk.LF, "shl"),
    seg(sk.hipR, sk.knR, "thr"),
    seg(sk.knR, sk.RF, "shr"),
  ];
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
  example,
}: Props) {
  const beta = useBeta(real, height, wallH, angle);
  const n = beta.moves.length;
  const g = beta.grade;
  const [t, setT] = useState(Math.min(initialMove, n));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 0.5>(1);
  const raf = useRef(0);

  useEffect(() => setT((v) => Math.min(v, n)), [n]);
  useEffect(() => {
    if (!playing) return;
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
  const go = (k: number) => {
    setPlaying(false);
    setT(Math.max(0, Math.min(n, k)));
  };

  return (
    <Screen name="screen/4-play">
      <TopBar step={4} />
      <div data-name="play/photo" className="relative h-[calc(58%-var(--sat)*0.42-74px)] shrink-0">
        <WallPhoto photo={photo} dim={0.3} aspect={beta.aspect}>
          <RouteOverlay strokeWidth={1.5} route={beta.route} others={beta.others} />
          <Climber pose={beta.poseAt(t)} activeLimb={active} trail={trail} />
        </WallPhoto>
        <span className={`${MONO} absolute top-3 left-3 rounded-[4px] bg-surface px-2 py-1`}>
          {height.toFixed(2)} m · {wallH.toFixed(1)} m wall
        </span>
        {example && (
          <span
            data-name="play/example-badge"
            className={`${MONO} absolute top-3 right-3 rounded-[4px] bg-tape-yellow px-2 py-1 text-ink`}
          >
            Example answer
          </span>
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
              className={`${MONO} inline-flex h-7 items-center gap-1.5 self-start rounded-[3px] border border-accent px-2 text-accent active:bg-accent active:text-surface`}
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
                className={`w-7 text-center font-mono text-[12px] font-medium ${i + 1 === move ? "text-accent" : "text-muted"}`}
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
              min={1.4}
              max={2}
              step={0.01}
              value={height}
              onChange={setHeight}
            />
          </div>
          <p
            data-name="play/height-status"
            className={`${MONO} mt-2 ${solveError ? "text-accent" : "text-muted"}`}
            aria-live="polite"
          >
            {resolving
              ? "Solving for this height..."
              : solveError
                ? solveError
                : example
                  ? "Example answer: start the solver to re-solve"
                  : "Drag to resolve: the sequence changes"}
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

export type Voice = "idle" | "listening" | "speaking";

export function LiveScreen({
  photo,
  height,
  wallH,
  voice: initialVoice = "idle",
  move = 4,
  onExit,
  beta: real,
}: {
  photo: string;
  height: number;
  wallH: number;
  voice?: Voice;
  move?: number;
  onExit?: () => void;
  beta?: BetaView;
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
  const next = () =>
    setVoice(voice === "idle" ? "listening" : voice === "listening" ? "speaking" : "idle");

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
        <WallPhoto photo={photo} name="live/camera" aspect={beta.aspect}>
          <Climber pose={beta.poseAt(k - 1)} />
          <line
            x1={wrist.x}
            y1={wrist.y}
            x2={target.x}
            y2={target.y}
            stroke={C.surface}
            strokeWidth={3}
            strokeDasharray="10 8"
          />
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
          <g data-name="live/wrist-point">
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
          </g>
        </WallPhoto>
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
        </div>
        <button
          data-name={`voice-coach/${voice}`}
          onClick={next}
          aria-label={`Voice coach: ${voice}`}
          className="flex shrink-0 flex-col items-center gap-2"
        >
          <span className="relative flex size-20 items-center justify-center">
            {voice === "listening" && (
              <>
                <span className="anim-pulse absolute inset-0 rounded-full border-2 border-accent" />
                <span className="anim-pulse absolute inset-0 rounded-full border-2 border-accent [animation-delay:600ms]" />
              </>
            )}
            <span
              className={`relative flex size-20 items-center justify-center rounded-full ${voice === "idle" ? "border border-ink bg-surface text-ink" : voice === "listening" ? "bg-accent text-surface" : "bg-ink text-surface"}`}
            >
              {voice === "speaking" ? <Waveform /> : <Mic />}
            </span>
          </span>
          <span className={`${MONO} text-center leading-tight`}>
            Voice coach
            <span
              className={`block text-[12px] ${voice === "idle" ? "text-muted" : "text-accent"}`}
            >
              {voice === "idle" ? "Tap to talk" : voice}
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
