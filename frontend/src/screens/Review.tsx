import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as RPE,
  type ReactNode,
  type WheelEvent,
} from "react";
import {
  C,
  HOLD_COLOURS,
  HOLD_TYPES,
  HOLDS,
  TYPE_INFO,
  UNSURE_ORDER,
  holdPath,
  type Hold,
  type HoldColour,
  type HoldType,
} from "../lib/wall";
import type { Prepared } from "../lib/contract";
import {
  BottomSheet,
  Btn,
  HoldShape,
  MONO,
  Screen,
  StickyBar,
  Tape,
  TopBar,
  WallPhoto,
} from "../ui/kit";

export type ReviewPreset = "empty" | "route" | "confirm" | "other";
type Tool = "add" | "delete" | "start" | "finish" | null;

type State = {
  holds: Hold[];
  route: HoldColour | null;
  start: string[];
  finish: string[];
  confirmed: Record<string, HoldType>;
};

function presetState(p: ReviewPreset, data?: Prepared): State {
  if (data) return { holds: data.holds, route: null, start: [], finish: [], confirmed: {} };
  const base: State = { holds: HOLDS, route: null, start: [], finish: [], confirmed: {} };
  if (p === "empty") return base;
  const routed = { ...base, route: "blue" as HoldColour, start: ["y1", "y2"], finish: ["y8"] };
  if (p === "route") return routed;
  return { ...routed, confirmed: { y3: "crimp", n5: "jug" } };
}

function autoEnds(holds: Hold[], c: HoldColour) {
  const hands = holds.filter((h) => h.colour === c && h.type !== "foot").sort((a, b) => b.y - a.y);
  if (!hands.length) return { start: [], finish: [] };
  return {
    start: hands.slice(0, hands.length > 3 ? 2 : 1).map((h) => h.id),
    finish: [hands[hands.length - 1].id],
  };
}

export function ReviewScreen({
  photo,
  preset = "empty",
  data,
  onNext,
}: {
  photo: string;
  preset?: ReviewPreset;
  /** Real detector output (contract/analyze.json). Without it, the design mock is shown. */
  data?: Prepared;
  onNext?: () => void;
}) {
  const [s, setS] = useState<State>(() => presetState(preset, data));
  const [tool, setTool] = useState<Tool>(null);
  const [sheet, setSheet] = useState<null | "confirm" | "other">(
    preset === "confirm" ? "confirm" : preset === "other" ? "other" : null,
  );
  const [current, setCurrent] = useState<string>(
    data ? (data.unsure[0] ?? "") : preset === "confirm" || preset === "other" ? "yA" : UNSURE_ORDER[0],
  );

  const routeHolds = useMemo(
    () => (s.route ? s.holds.filter((h) => h.colour === s.route).sort((a, b) => b.y - a.y) : []),
    [s.holds, s.route],
  );
  const routeIds = new Set(routeHolds.map((h) => h.id));
  // Real data: only holds on the chosen route are asked about (PLAN.md step 3).
  const unsure = data
    ? routeHolds.filter((h) => data.unsure.includes(h.id)).map((h) => h.id)
    : UNSURE_ORDER.filter((id) => s.holds.some((h) => h.id === id));
  const isOpenQ = (id: string) =>
    (data ? s.route !== null : true) && unsure.includes(id) && !s.confirmed[id];
  const routeLeft = routeHolds.filter((h) => isOpenQ(h.id)).length;
  const ready = !!s.route && routeLeft === 0;

  const nextUnsure = (from: string, confirmed: Record<string, HoldType>) => {
    const i = unsure.indexOf(from);
    for (let k = 1; k <= unsure.length; k++) {
      const id = unsure[(i + k) % unsure.length];
      if (!confirmed[id]) return id;
    }
    return null;
  };

  const answer = (type: HoldType) => {
    const confirmed = { ...s.confirmed, [current]: type };
    setS({ ...s, holds: s.holds.map((h) => (h.id === current ? { ...h, type } : h)), confirmed });
    const nx = nextUnsure(current, confirmed);
    if (nx) {
      setCurrent(nx);
      setSheet("confirm");
    } else setSheet(null);
  };

  const tapHold = (id: string) => {
    const hold = s.holds.find((h) => h.id === id)!;
    if (tool === "delete") {
      setS({
        ...s,
        holds: s.holds.filter((h) => h.id !== id),
        start: s.start.filter((x) => x !== id),
        finish: s.finish.filter((x) => x !== id),
      });
      return;
    }
    if ((tool === "start" || tool === "finish") && routeIds.has(id)) {
      const key = tool;
      const list = s[key].includes(id)
        ? s[key].filter((x) => x !== id)
        : [...s[key], id].slice(key === "start" ? -2 : -1);
      const other = key === "start" ? "finish" : "start";
      setS({ ...s, [key]: list, [other]: s[other].filter((x) => x !== id) });
      return;
    }
    if (hold.colour !== s.route) {
      setS({ ...s, route: hold.colour, ...autoEnds(s.holds, hold.colour) });
      return;
    }
    if (isOpenQ(id)) {
      setCurrent(id);
      setSheet("confirm");
    }
  };

  const tapEmpty = (x: number, y: number) => {
    if (tool !== "add") return;
    const colour = s.route ?? "blue";
    const id = `u${Date.now()}`;
    setS({
      ...s,
      holds: [...s.holds, { id, x, y, r: 18, colour, type: "jug", tag: "NEW", added: true }],
    });
    if (!s.route) setS((p) => ({ ...p, route: colour, ...autoEnds(p.holds, colour) }));
  };

  const caption =
    tool === "add"
      ? "Tap the wall to add a hold"
      : tool === "delete"
        ? "Tap a hold to delete it"
        : tool === "start"
          ? "Tap route holds to mark the start"
          : tool === "finish"
            ? "Tap a route hold to mark the finish"
            : "Tap a hold to select its whole colour";

  const currentHold = s.holds.find((h) => h.id === current);

  return (
    <Screen name="screen/2-review">
      <TopBar step={2} />
      <ZoomPhoto onTapHold={tapHold} onTapEmpty={tapEmpty}>
        <WallPhoto photo={photo} name="review/photo" aspect={data?.aspect}>
          <HoldsOverlay
            holds={s.holds}
            route={s.route}
            routeHolds={routeHolds}
            start={s.start}
            finish={s.finish}
            isOpenQ={isOpenQ}
          />
        </WallPhoto>
      </ZoomPhoto>

      <div data-name="review/tools" className="shrink-0 px-4 pt-3 pb-3">
        <p
          data-name="review/caption"
          className={`${MONO} flex h-6 items-center justify-between px-2 text-muted`}
        >
          <span>{caption}</span>
        </p>
        <div
          data-name="review/toolbar"
          role="toolbar"
          className="mt-2 grid grid-cols-4 overflow-hidden rounded-[6px] border border-ink"
        >
          {(
            [
              ["add", "Add hold"],
              ["delete", "Delete"],
              ["start", "Start"],
              ["finish", "Finish"],
            ] as const
          ).map(([k, label], i) => {
            const disabled = (k === "start" || k === "finish") && !s.route;
            const on = tool === k;
            return (
              <button
                key={k}
                data-name={`toolbar/${k}`}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => setTool(on ? null : k)}
                className={`flex h-12 items-center justify-center gap-1.5 text-[14px] font-semibold transition-colors disabled:text-hairline ${i ? "border-l border-ink" : ""} ${on ? "bg-ink text-surface" : "bg-surface text-ink active:bg-paper"}`}
              >
                {k === "start" && <Marker kind="S" small />}
                {k === "finish" && <Marker kind="F" small />}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <StickyBar>
        <Btn className="w-full" disabled={!ready} onClick={onNext}>
          Next: set climber
        </Btn>
        <button
          data-name="bottom-bar/status"
          disabled={!s.route || ready}
          onClick={() => {
            const first = routeHolds.find((h) => isOpenQ(h.id));
            if (first) {
              setCurrent(first.id);
              setSheet("confirm");
            }
          }}
          className={`${MONO} mt-1 flex h-8 w-full items-center justify-center gap-2 ${ready ? "text-ink" : "text-muted"}`}
        >
          {!s.route ? (
            "Pick a route colour first"
          ) : ready ? (
            <>
              <span className="size-1.5 rounded-full bg-tape-green" /> All route holds confirmed
            </>
          ) : (
            <>
              <span className="size-1.5 rounded-full bg-tape-yellow" />
              <span className="underline decoration-hairline underline-offset-4">
                {routeLeft} {routeLeft === 1 ? "hold" : "holds"} left to confirm
              </span>
            </>
          )}
        </button>
      </StickyBar>

      <BottomSheet
        name="sheet/confirm-hold"
        open={sheet === "confirm" && !!currentHold}
        onClose={() => setSheet(null)}
      >
        {currentHold && (
          <ConfirmHold
            hold={currentHold}
            photo={photo}
            aspect={data?.aspect}
            index={unsure.indexOf(current)}
            total={unsure.length}
            confirmed={s.confirmed}
            unsure={unsure}
            onAnswer={answer}
            onOther={() => setSheet("other")}
          />
        )}
      </BottomSheet>
      <BottomSheet
        name="sheet/all-hold-types"
        tall
        open={sheet === "other"}
        onClose={() => setSheet("confirm")}
      >
        <AllTypes onPick={answer} onBack={() => setSheet("confirm")} />
      </BottomSheet>
    </Screen>
  );
}

function Marker({ kind, small = false }: { kind: "S" | "F"; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center rounded-[3px] font-mono font-medium text-surface ${small ? "size-4 text-[10px]" : "size-5 text-[12px]"}`}
      style={{ background: kind === "S" ? C.green : C.accent }}
    >
      {kind}
    </span>
  );
}

function HoldsOverlay({
  holds,
  route,
  routeHolds,
  start,
  finish,
  isOpenQ,
}: {
  holds: Hold[];
  route: HoldColour | null;
  routeHolds: Hold[];
  start: string[];
  finish: string[];
  isOpenQ: (id: string) => boolean;
}) {
  const num = new Map(routeHolds.map((h, i) => [h.id, i + 1]));
  const ordered = [
    ...holds.filter((h) => h.colour !== route),
    ...holds.filter((h) => h.colour === route),
  ];
  return (
    <g data-name="review/holds">
      {ordered.map((h) => {
        const sel = route === h.colour;
        return (
          <g key={h.id} data-hold={h.id} style={{ cursor: "pointer" }}>
            {/* generous invisible hit area so small holds stay tappable */}
            <circle cx={h.x} cy={h.y} r={Math.max(h.r * 1.4, 34)} fill="transparent" />
            <HoldShape
              hold={h}
              opacity={route && !sel ? 0.35 : 1}
              stroke={sel ? C.accent : C.ink}
              strokeWidth={sel ? 3 : 1}
            />
          </g>
        );
      })}
      {routeHolds.map((h) => {
        const n = num.get(h.id)!;
        const tx = h.x + h.r * (h.sx ?? 1) + 8;
        return (
          <g key={`t-${h.id}`} pointerEvents="none">
            <rect x={tx} y={h.y - 44} width={52} height={32} rx={4} fill={C.ink} />
            <text
              x={tx + 26}
              y={h.y - 20}
              textAnchor="middle"
              fill={C.surface}
              fontSize={22}
              fontFamily="Barlow Semi Condensed"
              fontWeight={500}
              letterSpacing={1}
            >
              {String(n).padStart(2, "0")}
            </text>
          </g>
        );
      })}
      {[...start.map((id) => ["S", id] as const), ...finish.map((id) => ["F", id] as const)].map(
        ([k, id]) => {
          const h = holds.find((x) => x.id === id);
          if (!h) return null;
          const x = h.x - h.r * (h.sx ?? 1) - 58;
          const y = h.y - 4;
          return (
            <g key={`${k}-${id}`} pointerEvents="none">
              <line
                x1={x + 40}
                y1={y + 20}
                x2={h.x - h.r * 0.6}
                y2={h.y}
                stroke={C.ink}
                strokeWidth={2}
              />
              <rect
                x={x}
                y={y}
                width={40}
                height={40}
                rx={4}
                fill={k === "S" ? C.green : C.accent}
                stroke={C.surface}
                strokeWidth={3}
              />
              <text
                x={x + 20}
                y={y + 28}
                textAnchor="middle"
                fill={C.surface}
                fontSize={24}
                fontFamily="Barlow Semi Condensed"
                fontWeight={500}
              >
                {k}
              </text>
            </g>
          );
        },
      )}
      {holds
        .filter((h) => isOpenQ(h.id))
        .map((h) => (
          <g key={`q-${h.id}`} pointerEvents="none">
            <circle
              cx={h.x + h.r * 0.7}
              cy={h.y + h.r * 0.9}
              r={20}
              fill={C.yellow}
              stroke={C.ink}
              strokeWidth={2}
            />
            <text
              x={h.x + h.r * 0.7}
              y={h.y + h.r * 0.9 + 8}
              textAnchor="middle"
              fill={C.ink}
              fontSize={24}
              fontFamily="Barlow Semi Condensed"
              fontWeight={500}
            >
              ?
            </text>
          </g>
        ))}
    </g>
  );
}

/* Pinch to zoom, drag to pan, tap to select. */
function ZoomPhoto({
  children,
  onTapHold,
  onTapEmpty,
}: {
  children: ReactNode;
  onTapHold: (id: string) => void;
  onTapEmpty: (x: number, y: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, startX: 0, startY: 0 });

  const clamp = (n: { s: number; x: number; y: number }) => {
    const el = box.current!;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const s = Math.min(4, Math.max(1, n.s));
    return {
      s,
      x: Math.min(0, Math.max(w - w * s, n.x)),
      y: Math.min(0, Math.max(h - h * s, n.y)),
    };
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: RPE) => {
    box.current!.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, local(e));
    if (pts.current.size === 1)
      gesture.current = { moved: false, startX: e.clientX, startY: e.clientY };
    else gesture.current.moved = true;
  };
  const move = (e: RPE) => {
    const prev = pts.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    if (Math.hypot(e.clientX - gesture.current.startX, e.clientY - gesture.current.startY) > 6)
      gesture.current.moved = true;
    if (pts.current.size === 1) {
      setT((o) => clamp({ s: o.s, x: o.x + p.x - prev.x, y: o.y + p.y - prev.y }));
    } else if (pts.current.size === 2) {
      const [a, b] = [...pts.current.entries()];
      const other = a[0] === e.pointerId ? b[1] : a[1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y) || 1;
      const d1 = Math.hypot(p.x - other.x, p.y - other.y);
      const m0 = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
      const m1 = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
      setT((o) => {
        const s = Math.min(4, Math.max(1, (o.s * d1) / d0));
        const k = s / o.s;
        return clamp({ s, x: m1.x - (m0.x - o.x) * k, y: m1.y - (m0.y - o.y) * k });
      });
    }
    pts.current.set(e.pointerId, p);
  };
  const up = (e: RPE) => {
    const had = pts.current.size;
    pts.current.delete(e.pointerId);
    if (had !== 1 || gesture.current.moved) return;
    const hit = (document.elementsFromPoint(e.clientX, e.clientY) as Element[])
      .map((el) => el.closest("[data-hold]"))
      .find(Boolean);
    if (hit) return onTapHold(hit.getAttribute("data-hold")!);
    const svg = box.current!.querySelector("svg")!;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    onTapEmpty(Math.round(pt.x), Math.round(pt.y));
  };
  const wheel = (e: WheelEvent) => {
    const p = local(e);
    setT((o) => {
      const s = Math.min(4, Math.max(1, o.s * (e.deltaY < 0 ? 1.12 : 0.89)));
      const k = s / o.s;
      return clamp({ s, x: p.x - (p.x - o.x) * k, y: p.y - (p.y - o.y) * k });
    });
  };

  return (
    <div
      ref={box}
      data-name="review/photo-viewport"
      className="relative min-h-0 flex-1 touch-none overflow-hidden bg-ink select-none"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={(e) => pts.current.delete(e.pointerId)}
      onWheel={wheel}
    >
      <div
        className="absolute inset-0 origin-top-left"
        style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }}
      >
        {children}
      </div>
      <button
        data-name="review/zoom-chip"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={() => setT({ s: 1, x: 0, y: 0 })}
        className={`${MONO} absolute right-3 bottom-3 flex h-12 min-w-12 items-center justify-center rounded-[4px] border border-ink bg-surface px-3`}
        aria-label="Reset zoom"
      >
        {t.s > 1.02 ? `${t.s.toFixed(1)}x  Reset` : "Pinch to zoom"}
      </button>
    </div>
  );
}

function Closeup({ hold, photo, aspect }: { hold: Hold; photo: string; aspect?: number }) {
  const span = Math.max(hold.r * (hold.sx ?? 1), hold.r * (hold.sy ?? 1)) * 3.4;
  return (
    <div
      data-name="confirm/closeup"
      className="relative size-28 shrink-0"
      style={{ transform: "rotate(1.2deg)" }}
    >
      <Tape className="-top-2 -left-6 !w-14" rotate={-38} />
      <div className="absolute inset-0 overflow-hidden rounded-[4px] border border-ink bg-hairline">
        <img
          src={
            photo.startsWith("blob:") || photo.startsWith("http") || photo.startsWith("/")
              ? photo
              : `https://images.unsplash.com/photo-${photo}?fit=crop&w=600&q=80`
          }
          alt=""
          className="absolute w-[600%] max-w-none object-cover"
          style={{
            height: aspect ? `${600 * aspect}%` : "600%",
            left: `${50 - (hold.x / 1000) * 600}%`,
            top: `${50 - (hold.y / 1000) * 600}%`,
            filter: aspect ? "saturate(0.85)" : "grayscale(0.75) contrast(0.92)",
          }}
        />
        <svg
          viewBox={`${hold.x - span / 2} ${hold.y - span / 2} ${span} ${span}`}
          className="absolute inset-0 h-full w-full"
        >
          <path
            d={holdPath(hold)}
            fill={hold.hex ?? HOLD_COLOURS[hold.colour]}
            fillOpacity={0.9}
            stroke={C.accent}
            strokeWidth={3}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className={`${MONO} absolute bottom-1 left-1 rounded-[3px] bg-ink px-1 text-[10px] text-surface`}
        >
          {hold.tag}
        </span>
      </div>
    </div>
  );
}

function ConfirmHold({
  hold,
  photo,
  aspect,
  index,
  total,
  confirmed,
  unsure,
  onAnswer,
  onOther,
}: {
  hold: Hold;
  photo: string;
  aspect?: number;
  index: number;
  total: number;
  confirmed: Record<string, HoldType>;
  unsure: string[];
  onAnswer: (t: HoldType) => void;
  onOther: () => void;
}) {
  const guesses = hold.guesses ?? [
    ["jug", 50],
    ["crimp", 30],
    ["sloper", 10],
  ];
  return (
    <div className="flex min-h-0 flex-col overflow-y-auto px-6">
      <div className="flex items-center justify-between">
        <p data-name="confirm/label" className={`${MONO} shrink-0 pr-3 whitespace-nowrap text-muted`}>
          Confirm hold {index + 1} of {total}
        </p>
        <div data-name="confirm/progress-dots" className="flex min-w-0 gap-1 overflow-hidden" aria-hidden>
          {unsure.map((id, i) => (
            <span
              key={id}
              className={`h-1 shrink rounded-full ${i === index ? "w-5 bg-accent" : confirmed[id] ? "w-2 bg-ink" : "w-2 bg-hairline"}`}
            />
          ))}
        </div>
      </div>
      <div className="mt-4 flex items-end gap-4">
        <Closeup hold={hold} photo={photo} aspect={aspect} />
        <h2
          data-name="confirm/question"
          className="pb-1 font-display text-[32px] leading-[1.02] font-bold tracking-[0.005em]"
        >
          What kind of hold is this?
        </h2>
      </div>
      <ul data-name="confirm/answers" className="mt-6 border-t border-hairline">
        {guesses.map(([type, pct], i) => (
          <li key={type}>
            <button
              data-name={`answer/${type}`}
              onClick={() => onAnswer(type)}
              className="flex min-h-16 w-full items-center gap-4 border-b border-hairline py-3 text-left active:bg-paper"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[16px] font-semibold">
                  {TYPE_INFO[type].name}
                  {i === 0 && (
                    <span className={`${MONO} rounded-[3px] border border-ink px-1 text-[10px]`}>
                      Best guess
                    </span>
                  )}
                </span>
                <span className="block truncate text-[14px] text-muted">
                  {TYPE_INFO[type].line}
                </span>
              </span>
              <span className={`${MONO} text-[14px] ${i === 0 ? "text-accent" : "text-ink"}`}>
                {pct}%
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Btn variant="text" size="md" className="-ml-1 self-start px-1" onClick={onOther}>
        Other...
      </Btn>
    </div>
  );
}

function TypeSketch({ type }: { type: HoldType }) {
  const s = { fill: "none", stroke: C.ink, strokeWidth: 1.5 };
  return (
    <svg viewBox="0 0 48 48" className="size-12" aria-hidden>
      <rect x="0.5" y="0.5" width="47" height="47" rx="3" fill={C.paper} stroke={C.hairline} />
      {type === "jug" && (
        <path d="M12 18 Q24 10 36 18 Q38 30 24 34 Q10 30 12 18Z M16 22 Q24 26 32 22" {...s} />
      )}
      {type === "crimp" && <path d="M8 26 L40 22 L40 26 L8 30Z" {...s} />}
      {type === "sloper" && <path d="M8 34 Q24 6 40 34Z" {...s} />}
      {type === "pinch" && <path d="M20 8 Q28 8 28 24 Q28 40 20 40 Q16 24 20 8Z" {...s} />}
      {type === "pocket" && (
        <>
          <circle cx="24" cy="24" r="13" {...s} />
          <ellipse cx="24" cy="25" rx="5" ry="3.5" fill={C.ink} />
        </>
      )}
      {type === "volume" && <path d="M8 38 L24 8 L40 38Z M24 8 L26 38" {...s} />}
      {type === "foot" && <circle cx="24" cy="28" r="5" {...s} />}
    </svg>
  );
}

function AllTypes({ onPick, onBack }: { onPick: (t: HoldType) => void; onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-6">
      <div className="flex items-center justify-between">
        <p className={`${MONO} text-muted`}>All hold types</p>
        <Btn variant="text" size="md" className="-mr-2 px-2" onClick={onBack}>
          Back
        </Btn>
      </div>
      <h2 className="font-display text-[32px] leading-none font-bold tracking-[0.005em]">
        Pick the closest.
      </h2>
      <ul className="mt-4 min-h-0 flex-1 overflow-y-auto border-t border-hairline">
        {HOLD_TYPES.map((t) => (
          <li key={t}>
            <button
              data-name={`type/${t}`}
              onClick={() => onPick(t)}
              className="flex min-h-16 w-full items-center gap-4 border-b border-hairline py-2 text-left active:bg-paper"
            >
              <TypeSketch type={t} />
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold">{TYPE_INFO[t].name}</span>
                <span className="block text-[14px] text-muted">{TYPE_INFO[t].line}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
