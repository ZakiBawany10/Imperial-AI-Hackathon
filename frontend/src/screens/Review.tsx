import {
  useEffect,
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
import { API_URL, getHoldTypes } from "../lib/api";
import { routeStroke } from "./Route";
import { HoldTick } from "../ui/HoldPins";
import { selectRoute, type Prepared, type RoutePick } from "../lib/contract";
import {
  BottomSheet,
  Btn,
  Glyph,
  HoldShape,
  MONO,
  Screen,
  StickyBar,
  Tape,
  TopBar,
  WallPhoto,
} from "../ui/kit";

export type ReviewPreset = "empty" | "route" | "confirm" | "other";
type Tool = "add" | null;
type Sheet = null | "confirm" | "other" | "actions";

type State = {
  holds: Hold[];
  route: HoldColour | null;
  /** Real data: the selected route's hold ids. Mock: null, the route is the whole colour. */
  ids: string[] | null;
  start: string[];
  finish: string[];
  confirmed: Record<string, HoldType>;
};

function presetState(p: ReviewPreset, data?: Prepared): State {
  if (data) return { holds: data.holds, route: null, ids: null, start: [], finish: [], confirmed: {} };
  const base: State = { holds: HOLDS, route: null, ids: null, start: [], finish: [], confirmed: {} };
  if (p === "empty") return base;
  const routed = { ...base, route: "blue" as HoldColour, start: ["y1", "y2"], finish: ["y8"] };
  if (p === "route") return routed;
  return { ...routed, confirmed: { y3: "crimp", n5: "jug" } };
}

function autoEnds(route: Hold[]) {
  const hands = route.filter((h) => h.type !== "foot").sort((a, b) => b.y - a.y);
  if (!hands.length) return { start: [], finish: [] };
  return {
    start: hands.slice(0, hands.length > 3 ? 2 : 1).map((h) => h.id),
    finish: [hands[hands.length - 1].id],
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

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
  onNext?: (pick: RoutePick) => void;
}) {
  const [s, setS] = useState<State>(() => presetState(preset, data));
  const [tool, setTool] = useState<Tool>(null);
  const [sheet, setSheet] = useState<Sheet>(
    preset === "confirm" ? "confirm" : preset === "other" ? "other" : null,
  );
  const [current, setCurrent] = useState<string>(
    data ? (data.unsure[0] ?? "") : preset === "confirm" || preset === "other" ? "yA" : UNSURE_ORDER[0],
  );
  // "flow": walking through the open questions; "single": asked about one hold from its menu
  const [asking, setAsking] = useState<"flow" | "single">("flow");
  const [touched, setTouched] = useState(false);

  const routeHolds = useMemo(() => {
    if (!s.route) return [];
    const ids = s.ids && new Set(s.ids);
    return s.holds
      .filter((h) => (ids ? ids.has(h.id) : h.colour === s.route))
      .sort((a, b) => b.y - a.y);
  }, [s.holds, s.route, s.ids]);
  const routeIds = new Set(routeHolds.map((h) => h.id));
  const num = (id: string) => pad2(routeHolds.findIndex((h) => h.id === id) + 1);
  // Real data: only holds on the chosen route are asked about (PLAN.md step 3).
  const unsure = data
    ? routeHolds.filter((h) => data.unsure.includes(h.id)).map((h) => h.id)
    : UNSURE_ORDER.filter((id) => s.holds.some((h) => h.id === id));
  const isOpenQ = (id: string) =>
    (data ? s.route !== null : true) && unsure.includes(id) && !s.confirmed[id];
  const routeLeft = routeHolds.filter((h) => isOpenQ(h.id)).length;
  const routeAsked = routeHolds.filter((h) => unsure.includes(h.id)).length;
  const ends = s.start.length > 0 && s.finish.length > 0;
  const ready = !!s.route && routeLeft === 0 && ends;
  const step = !s.route ? 1 : !ends ? 2 : routeLeft > 0 ? 3 : 4;

  // Auto-zoom (real photos): fit the picked route.
  const focus = useMemo(() => {
    if (!data || !routeHolds.length) return null;
    const xs = routeHolds.flatMap((h) => [h.x - h.r * (h.sx ?? 1), h.x + h.r * (h.sx ?? 1)]);
    const ys = routeHolds.flatMap((h) => [h.y - h.r * (h.sy ?? 1), h.y + h.r * (h.sy ?? 1)]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }, [data, routeHolds]);

  const nextUnsure = (from: string, confirmed: Record<string, HoldType>) => {
    const i = unsure.indexOf(from);
    for (let k = 1; k <= unsure.length; k++) {
      const id = unsure[(i + k) % unsure.length];
      if (!confirmed[id] && routeIds.has(id)) return id;
    }
    return null;
  };

  const answer = (type: HoldType) => {
    const confirmed = { ...s.confirmed, [current]: type };
    setS({ ...s, holds: s.holds.map((h) => (h.id === current ? { ...h, type } : h)), confirmed });
    const nx = asking === "flow" ? nextUnsure(current, confirmed) : null;
    if (nx) {
      setCurrent(nx);
      setSheet("confirm");
    } else setSheet(null);
  };

  const askQuestions = () => {
    const first = routeHolds.find((h) => isOpenQ(h.id));
    if (!first) return;
    setAsking("flow");
    setCurrent(first.id);
    setSheet("confirm");
  };

  const pickRoute = (hold: Hold) => {
    const ids = data ? selectRoute(s.holds, hold, data.aspect) : null;
    // Start hold first (contract/README.md climb rules): its colour picks the climb,
    // and it's where the hands begin. The top hold is chosen next.
    setS({ ...s, route: hold.colour, ids, confirmed: {}, start: [hold.id], finish: [] });
  };
  const useHighest = () => {
    const top = routeHolds.filter((h) => !s.start.includes(h.id) && h.type !== "foot").at(-1);
    if (top) setS({ ...s, finish: [top.id] });
  };

  const tapHold = (id: string) => {
    setTouched(true);
    const hold = s.holds.find((h) => h.id === id)!;
    if (tool === "add") return;
    if (!s.route) return pickRoute(hold);
    if (!routeIds.has(id)) return addToRoute(id);
    // step 2: a tap on a route hold marks the top
    if (!s.finish.length && !s.start.includes(id)) return setS({ ...s, finish: [id] });
    setCurrent(id);
    setSheet("actions");
  };

  const tapEmpty = (x: number, y: number) => {
    setTouched(true);
    if (tool !== "add") return;
    setTool(null);
    const colour = s.route ?? "blue";
    const id = `u${Date.now()}`;
    const anchor = routeHolds[0];
    const hold: Hold = {
      id, x, y, r: 18, colour, type: "jug", tag: "NEW", added: true,
      hex: anchor?.hex, own: anchor?.own,
    };
    const holds = [...s.holds, hold];
    if (!s.route) {
      const ids = data ? [id] : null;
      const route = ids ? [hold] : holds.filter((h) => h.colour === colour);
      setS({ ...s, holds, route: colour, ids, ...autoEnds(route) });
    } else setS({ ...s, holds, ids: s.ids && [...s.ids, id] });
  };

  // A missed hold: one tap puts it on the route. "Pick another route" starts over.
  const addToRoute = (id: string) =>
    setS({ ...s, ids: [...(s.ids ?? routeHolds.map((h) => h.id)), id] });

  /* ---- the hold-actions menu ---- */
  const toggleEnd = (key: "start" | "finish", id: string) => {
    const list = s[key].includes(id)
      ? s[key].filter((x) => x !== id)
      : [...s[key], id].slice(key === "start" ? -2 : -1);
    const other = key === "start" ? "finish" : "start";
    setS({ ...s, [key]: list, [other]: s[other].filter((x) => x !== id) });
  };
  const removeFromRoute = (id: string) => {
    const ids = (s.ids ?? routeHolds.map((h) => h.id)).filter((x) => x !== id);
    setS({
      ...s,
      ids,
      start: s.start.filter((x) => x !== id),
      finish: s.finish.filter((x) => x !== id),
      route: ids.length ? s.route : null,
    });
    setSheet(null);
  };
  const askAbout = (id: string) => {
    setAsking(isOpenQ(id) ? "flow" : "single");
    setCurrent(id);
    setSheet("confirm");
  };
  const clearRoute = () => {
    setS({ ...s, route: null, ids: null, start: [], finish: [], confirmed: {} });
    setTool(null);
  };

  const instruction =
    tool === "add"
      ? "Tap the wall where the missing hold is"
      : step === 1
        ? "Tap the start hold, the one you begin on. Its colour picks the climb."
        : step === 2
          ? !s.start.length
            ? "Tap a route hold, then mark it as the start."
            : "Now tap the top hold, or use the highest of this colour."
          : step === 3
            ? "Tap a hold with a ?, or press the button below. Tap any missed hold to add it."
            : `Start ${s.start.map(num).join(" + ")}, finish ${s.finish.map(num).join("")}. Tap a missed hold to add it, or a route hold to change it.`;

  const cta = !s.route
    ? { label: "Tap the start hold", enabled: false, go: () => {} }
    : !ends
      ? s.start.length
        ? { label: "Use the highest as the top", enabled: true, go: useHighest }
        : { label: "Mark a start hold", enabled: false, go: () => {} }
      : routeLeft > 0
        ? {
            label: `Answer ${routeLeft} ${routeLeft === 1 ? "question" : "questions"}`,
            enabled: true,
            go: askQuestions,
          }
        : {
            label: "Next: set climber",
            enabled: true,
            go: () =>
              s.route &&
              onNext?.({
                colour: s.route,
                holds: routeHolds,
                start: s.start,
                finish: s.finish,
                confirmed: s.confirmed,
              }),
          };

  const currentHold = s.holds.find((h) => h.id === current);
  const qIndex = asking === "flow" ? unsure.indexOf(current) : 0;
  const qList = asking === "flow" ? unsure : [current];

  return (
    <Screen name="screen/2-review">
      <TopBar step={2} />
      <ZoomPhoto
        onTapHold={tapHold}
        onTapEmpty={tapEmpty}
        focus={focus}
        aspect={data?.aspect}
        hint={!s.route && !touched ? "Tap the start hold" : null}
      >
        <WallPhoto photo={photo} name="review/photo" aspect={data?.aspect}>
          <HoldsOverlay
            holds={s.holds}
            inRoute={routeIds}
            routeHolds={routeHolds}
            start={s.start}
            finish={s.finish}
            isOpenQ={isOpenQ}
          />
        </WallPhoto>
      </ZoomPhoto>

      <div data-name="review/tools" className="shrink-0 px-5 pt-3 pb-2">
        <ol data-name="review/steps" className="grid grid-cols-3 gap-1.5" aria-label="Steps">
          {(
            [
              ["Start", step > 1],
              ["Top", step > 2],
              [routeAsked ? `Types ${routeAsked - routeLeft}/${routeAsked}` : "Types", step > 3],
            ] as const
          ).map(([label, done], i) => {
            const now = step === i + 1;
            return (
              <li
                key={i}
                data-name={`step/${i + 1}`}
                aria-current={now ? "step" : undefined}
                className={`flex h-9 items-center gap-1.5 rounded-[4px] border px-2 ${now ? "border-accent bg-accent/8 text-ink" : done ? "border-hairline text-ink" : "border-hairline text-muted"}`}
              >
                {done ? (
                  <HoldTick size={22} kind={(["jug", "sloper", "crimp"] as const)[i]} className="-my-1 shrink-0" />
                ) : (
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[12px] font-semibold ${now ? "bg-accent text-surface" : "bg-hairline text-muted"}`}
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                )}
                <span className="truncate text-[13px] leading-none font-semibold">{label}</span>
              </li>
            );
          })}
        </ol>
        <p data-name="review/instruction" className="mt-2.5 min-h-[40px] text-[15px] leading-[1.35] text-ink" aria-live="polite">
          {instruction}
        </p>
        <div className="flex items-center justify-between">
          <button
            data-name="review/add-hold"
            aria-pressed={tool === "add"}
            onClick={() => setTool(tool === "add" ? null : "add")}
            className={`${MONO} -ml-1 flex h-10 items-center gap-1.5 px-1 text-[12px] ${tool === "add" ? "text-accent-ink" : "text-muted"}`}
          >
            <span aria-hidden className="text-[16px] leading-none">+</span>
            {tool === "add" ? "Cancel add" : "Add a missed hold"}
          </button>
          {s.route && (
            <button
              data-name="review/change-route"
              onClick={clearRoute}
              className={`${MONO} -mr-1 flex h-10 items-center px-1 text-[12px] text-muted`}
            >
              Pick another route
            </button>
          )}
        </div>
      </div>

      <StickyBar>
        <Btn name="review/cta" className="w-full" disabled={!cta.enabled} onClick={cta.go}>
          {cta.label}
        </Btn>
      </StickyBar>

      <BottomSheet name="sheet/hold-actions" open={sheet === "actions" && !!currentHold} onClose={() => setSheet(null)}>
        {currentHold && (
          <HoldActions
            hold={currentHold}
            photo={photo}
            aspect={data?.aspect}
            number={num(currentHold.id)}
            isStart={s.start.includes(currentHold.id)}
            isFinish={s.finish.includes(currentHold.id)}
            open={isOpenQ(currentHold.id)}
            onStart={() => toggleEnd("start", currentHold.id)}
            onFinish={() => toggleEnd("finish", currentHold.id)}
            onType={() => askAbout(currentHold.id)}
            onRemove={() => removeFromRoute(currentHold.id)}
          />
        )}
      </BottomSheet>
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
            index={qIndex}
            total={qList.length}
            confirmed={s.confirmed}
            unsure={qList}
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
        <AllTypes onPick={answer} onBack={() => setSheet("confirm")} live={!!data} />
      </BottomSheet>
    </Screen>
  );
}

function Marker({ kind, small = false }: { kind: "S" | "F"; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center rounded-[3px] font-mono font-medium text-surface ${small ? "size-4 text-[10px]" : "size-5 text-[12px]"}`}
      style={{ background: kind === "S" ? C.green : C.ink }}
    >
      {kind}
    </span>
  );
}

/** Tapping a hold that's on the route: what to do with it. */
function HoldActions({
  hold,
  photo,
  aspect,
  number,
  isStart,
  isFinish,
  open,
  onStart,
  onFinish,
  onType,
  onRemove,
}: {
  hold: Hold;
  photo: string;
  aspect?: number;
  number: string;
  isStart: boolean;
  isFinish: boolean;
  open: boolean;
  onStart: () => void;
  onFinish: () => void;
  onType: () => void;
  onRemove: () => void;
}) {
  const Row = ({
    name,
    icon,
    title,
    sub,
    subAccent = false,
    right,
    onClick,
    danger = false,
  }: {
    name: string;
    icon: ReactNode;
    title: string;
    sub: string;
    subAccent?: boolean;
    right?: ReactNode;
    onClick: () => void;
    danger?: boolean;
  }) => (
    <li>
      <button
        data-name={`action/${name}`}
        onClick={onClick}
        className="flex min-h-16 w-full items-center gap-4 border-b border-hairline py-2 text-left active:bg-paper"
      >
        <span className="flex size-8 shrink-0 items-center justify-center">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[16px] font-semibold ${danger ? "text-alert" : ""}`}>{title}</span>
          <span className={`block text-[14px] ${subAccent ? "text-accent-ink" : "text-muted"}`}>{sub}</span>
        </span>
        {right}
      </button>
    </li>
  );
  const Switch = ({ on }: { on: boolean }) => (
    <span
      aria-hidden
      className={`${MONO} flex h-7 w-12 items-center justify-center rounded-full border text-[11px] ${on ? "border-ink bg-ink text-surface" : "border-hairline text-muted"}`}
    >
      {on ? "On" : "Off"}
    </span>
  );
  return (
    <div className="flex min-h-0 flex-col overflow-y-auto px-6">
      <div className="flex items-end gap-4">
        <Closeup hold={hold} photo={photo} aspect={aspect} label={number} />
        <div className="pb-1">
          <p className={`${MONO} text-muted`}>
            Hold {number} · {TYPE_INFO[hold.type].name}
          </p>
          <h2 className="mt-1 font-display text-[30px] leading-[1.02] font-bold tracking-[0.005em]">
            What's this hold for?
          </h2>
        </div>
      </div>
      <ul data-name="hold-actions/list" className="mt-5 border-t border-hairline">
        <Row
          name="start"
          icon={<Marker kind="S" />}
          title="Start hold"
          sub="Where your hands begin (up to two)"
          right={<Switch on={isStart} />}
          onClick={onStart}
        />
        <Row
          name="finish"
          icon={<Marker kind="F" />}
          title="Finish hold"
          sub="The last hold of the climb"
          right={<Switch on={isFinish} />}
          onClick={onFinish}
        />
        <Row
          name="type"
          icon={<span className="flex size-6 items-center justify-center rounded-full border-2 border-ink font-mono text-[13px] font-bold">?</span>}
          title="What type is it?"
          sub={open ? "Needs an answer" : `Currently: ${TYPE_INFO[hold.type].name}`}
          subAccent={open}
          onClick={onType}
        />
        <Row
          name="remove"
          icon={<Glyph kind="close" className="size-4 text-alert" />}
          title="Remove from route"
          sub="It isn't part of this climb"
          onClick={onRemove}
          danger
        />
      </ul>
    </div>
  );
}

function HoldsOverlay({
  holds,
  inRoute,
  routeHolds,
  start,
  finish,
  isOpenQ,
}: {
  holds: Hold[];
  inRoute: Set<string>;
  routeHolds: Hold[];
  start: string[];
  finish: string[];
  isOpenQ: (id: string) => boolean;
}) {
  const num = new Map(routeHolds.map((h, i) => [h.id, i + 1]));
  const route = inRoute.size > 0;
  const ordered = [...holds.filter((h) => !inRoute.has(h.id)), ...holds.filter((h) => inRoute.has(h.id))];
  return (
    <g data-name="review/holds">
      {/* Before a pick every hold is a button: its own colour, a white ring that breathes. */}
      {!route && (
        <g className="anim-breathe" pointerEvents="none" aria-hidden>
          {holds.map((h) => (
            <circle
              key={`ring-${h.id}`}
              cx={h.x}
              cy={h.y}
              r={Math.max(h.r * Math.max(h.sx ?? 1, h.sy ?? 1) * 1.25, 9)}
              fill="none"
              stroke={C.surface}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      )}
      {ordered.map((h) => {
        const sel = inRoute.has(h.id);
        return (
          <g key={h.id} data-hold={h.id} style={{ cursor: "pointer" }}>
            {/* generous invisible hit area so small holds stay tappable */}
            <circle cx={h.x} cy={h.y} r={Math.max(h.r * 1.4, 34)} fill="transparent" />
            {route ? (
              <>
                {sel && (
                  <path
                    d={holdPath(h)}
                    fill="none"
                    stroke={C.ink}
                    strokeOpacity={0.55}
                    strokeWidth={5}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <HoldShape
                  hold={h}
                  opacity={sel ? 1 : 0.18}
                  stroke={sel ? routeStroke(h.id, start, finish) : C.ink}
                  strokeWidth={sel ? 3 : 1}
                />
              </>
            ) : (
              <path
                d={holdPath(h)}
                fill={h.own ?? h.hex ?? HOLD_COLOURS[h.colour]}
                fillOpacity={0.9}
                stroke={C.ink}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
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
              {pad2(n)}
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
              <line x1={x + 40} y1={y + 20} x2={h.x - h.r * 0.6} y2={h.y} stroke={C.ink} strokeWidth={2} />
              <rect
                x={x}
                y={y}
                width={40}
                height={40}
                rx={4}
                fill={k === "S" ? C.green : C.ink}
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
      <g className="anim-breathe">
        {holds
          .filter((h) => isOpenQ(h.id))
          .map((h) => (
            <g key={`q-${h.id}`} pointerEvents="none">
              <circle cx={h.x + h.r * 0.7} cy={h.y + h.r * 0.9} r={20} fill={C.yellow} stroke={C.ink} strokeWidth={2} />
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
    </g>
  );
}

type Box = { x0: number; y0: number; x1: number; y1: number };

/* Pinch to zoom, drag to pan, tap to select. `focus` (real photos) glides to fit a box. */
function ZoomPhoto({
  children,
  onTapHold,
  onTapEmpty,
  focus,
  aspect,
  hint,
}: {
  children: ReactNode;
  onTapHold: (id: string) => void;
  onTapEmpty: (x: number, y: number) => void;
  focus?: Box | null;
  aspect?: number;
  hint?: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const [glide, setGlide] = useState(false);
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

  // Fit the focus box: WallPhoto shows a real photo as big as fits, centred, so
  // its displayed width is min(W, H/aspect); one overlay unit is that / 1000 px.
  const key = focus ? `${focus.x0.toFixed(0)},${focus.y0.toFixed(0)},${focus.x1.toFixed(0)},${focus.y1.toFixed(0)}` : "";
  useEffect(() => {
    const el = box.current;
    if (!el || !aspect) return;
    setGlide(true);
    if (!focus) return setT({ s: 1, x: 0, y: 0 });
    const W = el.clientWidth;
    const H = el.clientHeight;
    const dw = Math.min(W, H / aspect);
    const k = dw / 1000;
    const offX = (W - dw) / 2;
    const off = (H - dw * aspect) / 2;
    const bw = Math.max(40, focus.x1 - focus.x0) * k;
    const bh = Math.max(40, focus.y1 - focus.y0) * k;
    const s = Math.min(4, Math.max(1, 0.8 * Math.min(W / bw, H / bh)));
    const cx = offX + ((focus.x0 + focus.x1) / 2) * k;
    const cy = off + ((focus.y0 + focus.y1) / 2) * k;
    setT(clamp({ s, x: W / 2 - cx * s, y: H / 2 - cy * s }));
  }, [key, aspect]); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: RPE) => {
    setGlide(false);
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
    setGlide(false);
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
        style={{
          transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`,
          transition: glide ? "transform 350ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none",
        }}
      >
        {children}
      </div>
      {hint && (
        <div
          data-name="review/hint"
          className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center"
        >
          <span className="flex items-center gap-2 rounded-full border border-ink bg-surface px-4 py-2.5 text-[15px] font-semibold shadow-[0_2px_0_#243E36]">
            <TapGlyph />
            {hint}
          </span>
        </div>
      )}
      <button
        data-name="review/zoom-chip"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={() => {
          setGlide(true);
          setT({ s: 1, x: 0, y: 0 });
        }}
        // Not zoomed: just a hint, so taps pass through to holds underneath it.
        className={`${MONO} absolute right-3 bottom-3 flex h-10 min-w-12 items-center justify-center rounded-[4px] border border-ink bg-surface px-3 text-[12px] ${t.s > 1.02 ? "" : "pointer-events-none opacity-80"}`}
        aria-label={t.s > 1.02 ? "Show whole wall" : "Pinch to zoom"}
      >
        {t.s > 1.02 ? "Show whole wall" : "Pinch to zoom"}
      </button>
    </div>
  );
}

/** A fingertip tapping, for the hint pill. */
function TapGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <circle cx="12" cy="9" r="6.5" fill="none" stroke={C.accent} strokeWidth="1.6" className="anim-breathe" />
      <path
        d="M10.5 9.5v6.2l-1.4-1.3c-.6-.6-1.6-.5-2 .2-.3.5-.2 1.1.2 1.5l3.3 3.7c.6.7 1.5 1.1 2.4 1.1h2.3c1.9 0 3.4-1.5 3.4-3.4v-3.3c0-.8-.6-1.4-1.4-1.4-.3 0-.6.1-.8.3v-.4c0-.8-.6-1.4-1.4-1.4-.4 0-.7.1-.9.4-.2-.6-.7-1-1.3-1-.3 0-.6.1-.8.3V9.5c0-.8-.6-1.4-1.4-1.4s-1.2.6-1.2 1.4Z"
        fill={C.surface}
        stroke={C.ink}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Closeup({
  hold,
  photo,
  aspect,
  label,
}: {
  hold: Hold;
  photo: string;
  aspect?: number;
  /** shown in the corner instead of the detector's tag, e.g. the route number */
  label?: string;
}) {
  // Show about 3.4 hold-widths around the hold. Real photos zoom to fit that
  // span so the outline sits on the hold; the design mock keeps its fixed 6x.
  const span = Math.max(40, Math.max(hold.r * (hold.sx ?? 1), hold.r * (hold.sy ?? 1)) * 3.4);
  const zoom = aspect ? (1000 / span) * 100 : 600; // % of the box
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
          className="absolute max-w-none object-cover"
          style={{
            width: `${zoom}%`,
            height: aspect ? `${zoom * aspect}%` : `${zoom}%`,
            left: `${50 - (hold.x / 1000) * zoom}%`,
            top: `${50 - (hold.y / 1000) * zoom}%`,
            filter: aspect ? "none" : "grayscale(0.75) contrast(0.92)",
          }}
        />
        <svg
          viewBox={`${hold.x - span / 2} ${hold.y - span / 2} ${span} ${span}`}
          className="absolute inset-0 h-full w-full"
        >
          {aspect ? (
            // real photo: outline only, so the hold itself stays visible
            <>
              <path
                d={holdPath(hold, 1.25)}
                fill="none"
                stroke={C.surface}
                strokeWidth={4}
                strokeOpacity={0.8}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={holdPath(hold, 1.25)}
                fill="none"
                stroke={C.accent}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : (
            <path
              d={holdPath(hold)}
              fill={hold.hex ?? HOLD_COLOURS[hold.colour]}
              fillOpacity={0.9}
              stroke={C.accent}
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <span
          className={`${MONO} absolute bottom-1 left-1 rounded-[3px] bg-ink px-1 text-[10px] text-surface`}
        >
          {label ?? hold.tag}
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
              <span className={`${MONO} text-[14px] ${i === 0 ? "text-accent-ink" : "text-ink"}`}>
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
      {type === "unknown" && (
        <text x="24" y="31" textAnchor="middle" fontSize="20" fontFamily="Barlow Semi Condensed" fill={C.ink}>
          ?
        </text>
      )}
    </svg>
  );
}

/** Hold type picture from the API server, the drawn sketch when it can't load. */
function TypePic({ type, image }: { type: HoldType; image?: string }) {
  const [failed, setFailed] = useState(false);
  if (!image || failed) return <TypeSketch type={type} />;
  return (
    <img
      src={image.startsWith("http") ? image : API_URL + image}
      alt=""
      onError={() => setFailed(true)}
      className="size-12 shrink-0 rounded-[3px] border border-hairline bg-paper object-contain"
    />
  );
}

function AllTypes({
  onPick,
  onBack,
  live = false,
}: {
  onPick: (t: HoldType) => void;
  onBack: () => void;
  /** list from GET /hold-types (PLAN: never hard-coded) instead of the design list */
  live?: boolean;
}) {
  const known = (t: string): t is HoldType => t === "unknown" || t in TYPE_INFO;
  const items = live
    ? getHoldTypes()
        .filter((t) => known(t.id))
        .map((t) => ({ id: t.id as HoldType, name: t.name, line: t.description, image: t.image }))
    : HOLD_TYPES.map((t) => ({ id: t as HoldType, name: TYPE_INFO[t].name, line: TYPE_INFO[t].line, image: undefined }));
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
        {items.map((t) => (
          <li key={t.id}>
            <button
              data-name={`type/${t.id}`}
              onClick={() => onPick(t.id)}
              className="flex min-h-16 w-full items-center gap-4 border-b border-hairline py-2 text-left active:bg-paper"
            >
              <TypePic type={t.id} image={t.image} />
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold">{t.name}</span>
                <span className="block text-[14px] text-muted">{t.line}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
