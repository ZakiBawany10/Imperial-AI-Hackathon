import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { PHOTOS } from "./lib/wall";
import { buildSolve, prepare, type Prepared, type RoutePick } from "./lib/contract";
import {
  API_URL,
  ApiError,
  HEIGHT_RANGE,
  analyze,
  depth,
  getHoldTypes,
  loadHoldTypes,
  qualityOf,
  shrinkPhoto,
  solve,
  type SolveRequest,
  type SolveResponse,
} from "./lib/api";
import { realBeta, type BetaView } from "./lib/beta";
import { useCoach } from "./lib/coach";
import { MONO } from "./ui/kit";
import { Wordmark } from "./ui/Logo";
import { UploadScreen } from "./screens/Upload";
import { ReviewScreen, type ReviewPreset } from "./screens/Review";
import { ANGLES, RouteScreen, type Angle } from "./screens/Route";
import { LiveScreen, PlayScreen, type Voice } from "./screens/Play";

const WALL = PHOTOS.wall01;
// Krishna's face-on gym walls, served by the backend (backend/demo/walls/), with the
// height of wall each one shows. They go through the live POST /analyze like any upload.
const EXAMPLES = [
  { id: "wall-1", label: "Wall 1", photo: `${API_URL}/demo/walls/wall-1.jpg`, wallM: 4.3 },
  { id: "wall-2", label: "Wall 2", photo: `${API_URL}/demo/walls/wall-2.jpg`, wallM: 4.0 },
];

function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

/* ---------- prototype: the real flow ---------- */
type Step = "upload" | "finding" | "review" | "route" | "solving" | "play" | "live";
type Solved = { beta: BetaView; req: SolveRequest; res: SolveResponse };

const errText = (e: unknown) =>
  e instanceof ApiError ? e.message : "Something went wrong talking to the server.";
const isAbort = (e: unknown) => (e as Error)?.name === "AbortError";
const aspectOf = (url: string) =>
  new Promise<number | undefined>((ok) => {
    const img = new Image();
    img.onload = () => ok(img.naturalHeight / img.naturalWidth || undefined);
    img.onerror = () => ok(undefined);
    img.src = url;
  });

function Flow() {
  const [step, setStep] = useState<Step>("upload");
  const [photo, setPhoto] = useState<string>("");
  const [height, setHeight] = useState(1.75);
  const [strength, setStrength] = useState(1.0);
  const [wallH, setWallH] = useState(4.0);
  const [angle, setAngle] = useState<Angle>("vertical");
  const [move, setMove] = useState(0);
  // the wall being worked on: a photo /analyze answered for, and the photo itself
  const [wall, setWall] = useState<Prepared | null>(null);
  const photoBlob = useRef<Blob | null>(null);
  const [relief, setRelief] = useState<string | null>(null);
  const [found, setFound] = useState<{ wall: Prepared | null; aspect?: number; error?: string | null }>({
    wall: null,
  });
  const [pick, setPick] = useState<RoutePick | null>(null);
  const [solved, setSolved] = useState<Solved | null>(null);
  const [solveErr, setSolveErr] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveErr, setResolveErr] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const finding = useRef<AbortController | null>(null);
  const solvedRef = useRef<Solved | null>(null);
  solvedRef.current = solved;

  useEffect(() => {
    loadHoldTypes(); // quality per type comes from GET /hold-types when the server is up
  }, []);

  /* ---- 1. photo -> POST /analyze (examples too: no saved answers) ---- */
  const onPhoto = async (src: string, file?: File) => {
    finding.current?.abort();
    const ctl = new AbortController();
    finding.current = ctl;
    setStep("finding");
    setPhoto(src);
    setFound({ wall: null });
    const example = EXAMPLES.find((e) => e.photo === src);
    if (example) setWallH(example.wallM);
    if (!file) {
      try {
        const b = await (await fetch(src)).blob();
        file = new File([b], "wall.jpg", { type: b.type || "image/jpeg" });
      } catch {
        setFound({ wall: null, error: `Couldn't load the example wall from ${API_URL}. Is backend/run.sh running?` });
        return;
      }
      if (ctl.signal.aborted) return;
    }
    const blob = await shrinkPhoto(file);
    const url = blob === file ? (src.startsWith("blob:") ? src : URL.createObjectURL(blob)) : URL.createObjectURL(blob);
    const aspect = await aspectOf(url);
    if (ctl.signal.aborted) return;
    photoBlob.current = blob;
    setRelief(null);
    setPhoto(url);
    setFound({ wall: null, aspect });
    try {
      const res = await analyze(blob, ctl.signal);
      if (ctl.signal.aborted) return;
      if (!res.holds.length) throw new ApiError("No holds found in this photo. Try one taken straight on.", 200);
      setFound({ wall: prepare(url, res), aspect });
    } catch (e) {
      if (isAbort(e) || ctl.signal.aborted) return;
      setFound({ wall: null, aspect, error: errText(e) });
    }
  };
  const foundRef = useRef(found);
  foundRef.current = found;
  const onFound = useCallback(() => {
    const w = foundRef.current.wall;
    if (!w) return;
    setWall(w);
    setPick(null);
    setSolved(null);
    setStep("review");
  }, []);

  const others = (w: Prepared, route: { id: string }[]) => {
    const ids = new Set(route.map((h) => h.id));
    return w.holds.filter((h) => !ids.has(h.id));
  };

  /* ---- 2. picked route -> POST /solve ---- */
  const runSolve = async (h: number, s: number, signal: AbortSignal): Promise<Solved> => {
    const deg = ANGLES.find((a) => a.k === angle)!.deg;
    const { req, byId } = buildSolve(wall!, pick!, { height: h, wallH, angleDeg: deg, strength: s }, qualityOf);
    const res = await solve(req, signal);
    const beta = realBeta(res, {
      req,
      holdTypes: getHoldTypes(),
      imageW: wall!.image.w,
      aspect: wall!.aspect,
      wallH,
      colour: pick!.colour,
      route: pick!.holds,
      others: others(wall!, pick!.holds),
      byId,
    });
    return { beta, req, res };
  };

  const startSolve = async () => {
    inflight.current?.abort();
    const ctl = new AbortController();
    inflight.current = ctl;
    setSolveErr(null);
    setStep("solving");
    // The 3D wall's relief map, fetched once per photo while the solver runs.
    if (!relief && photoBlob.current) depth(photoBlob.current).then((u) => u && setRelief(u));
    // Hold the tracing animation long enough to read; the solver takes ~0.1 s.
    const minWait = new Promise((r) => setTimeout(r, 1200));
    try {
      const out = await runSolve(height, strength, ctl.signal);
      await minWait;
      if (ctl.signal.aborted) return;
      setSolved(out);
      setResolveErr(null);
      setMove(0);
      setStep("play");
    } catch (e) {
      if (isAbort(e)) return;
      await minWait;
      setSolveErr(errText(e));
    }
  };

  /* ---- 3. height or strength changes re-solve (Play controls, or the coach) ---- */
  const resolveAt = async (h: number, s: number, signal: AbortSignal) => {
    setResolving(true);
    try {
      const out = await runSolve(h, s, signal);
      if (signal.aborted) return;
      solvedRef.current = out; // the coach reads it straight after
      setSolved(out);
      setResolveErr(null);
    } catch (e) {
      if (isAbort(e)) return;
      setResolveErr(errText(e));
      throw e;
    } finally {
      if (!signal.aborted) setResolving(false);
    }
  };
  const dirty = useRef(false);
  useEffect(() => {
    if (step !== "play" || !solved || !dirty.current) return;
    const ctl = new AbortController();
    setResolving(true);
    const t = setTimeout(() => {
      dirty.current = false;
      resolveAt(height, strength, ctl.signal).catch(() => {});
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [height, strength]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- voice coach (coach/coachTools.js over the current solve) ---- */
  const coach = useCoach({
    getState: () =>
      solvedRef.current
        ? { request: solvedRef.current.req, solve: solvedRef.current.res, holdTypes: getHoldTypes() }
        : null,
    onHeightChange: async (h) => {
      if (h < HEIGHT_RANGE[0] || h > HEIGHT_RANGE[1])
        throw new Error(`height must be between ${HEIGHT_RANGE[0]} and ${HEIGHT_RANGE[1]} m`);
      setHeight(h);
      await resolveAt(h, strength, new AbortController().signal);
    },
    onStep: (i) => setMove(i + 1),
  });

  switch (step) {
    case "upload":
    case "finding":
      return (
        <UploadScreen
          photo={step === "finding" ? photo : null}
          examples={EXAMPLES}
          real={{ found: found.wall, aspect: found.aspect, error: found.error }}
          onPhoto={onPhoto}
          onCancel={() => {
            finding.current?.abort();
            setStep("upload");
          }}
          onFound={onFound}
        />
      );
    case "review":
      return (
        <ReviewScreen
          key={wall!.photo}
          photo={wall!.photo}
          data={wall!}
          onNext={(p) => {
            setPick(p);
            setStep("route");
          }}
        />
      );
    case "route":
    case "solving":
      return (
        <RouteScreen
          {...{ height, setHeight, wallH, setWallH, angle, setAngle, strength, setStrength }}
          photo={wall!.photo}
          aspect={wall!.aspect}
          route={pick?.holds}
          start={pick?.start}
          finish={pick?.finish}
          others={pick ? others(wall!, pick.holds) : wall!.holds}
          colour={pick?.colour}
          solving={step === "solving"}
          error={solveErr}
          onSolve={startSolve}
          onCancel={() => {
            inflight.current?.abort();
            setSolveErr(null);
            setStep("route");
          }}
        />
      );
    case "play":
      return (
        <PlayScreen
          {...{ wallH, angle }}
          photo={wall!.photo}
          height={height}
          setHeight={(h) => {
            dirty.current = true;
            setHeight(h);
          }}
          strength={strength}
          setStrength={(s) => {
            dirty.current = true;
            setStrength(s);
          }}
          beta={solved!.beta}
          viewer={{ imageUrl: wall!.photo, analyze: wall!.raw, reliefUrl: relief, req: solved!.req, res: solved!.res }}
          resolving={resolving}
          solveError={resolveErr}
          initialMove={move}
          onNewWall={() => {
            coach.stop();
            setStep("upload");
          }}
          onLive={(m) => {
            setMove(Math.max(1, m));
            setStep("live");
          }}
        />
      );
    case "live":
      return (
        <LiveScreen
          {...{ height, wallH }}
          move={Math.max(1, move)}
          photo={wall!.photo}
          beta={solved!.beta}
          coach={coach}
          onMove={(m) => setMove(m)}
          onExit={() => {
            coach.stop();
            setStep("play");
          }}
        />
      );
  }
}

/* ---------- device chrome ---------- */
function StatusBar() {
  return (
    <div
      data-name="ios/status-bar"
      className="pointer-events-none absolute inset-x-0 top-0 z-50 flex h-[54px] items-center justify-between px-8 pt-1 text-ink"
    >
      <span className="w-14 text-[16px] font-semibold">9:41</span>
      <span className="h-[34px] w-[124px] rounded-full bg-ink" />
      <span className="flex w-14 items-center justify-end gap-1.5">
        <svg viewBox="0 0 18 12" className="h-3 w-[18px]" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x={i * 4.6}
              y={9 - i * 3}
              width="3"
              height={3 + i * 3}
              rx="0.8"
              fill="currentColor"
            />
          ))}
        </svg>
        <svg viewBox="0 0 26 12" className="h-3 w-[26px]" aria-hidden>
          <rect
            x="0.5"
            y="0.5"
            width="22"
            height="11"
            rx="3"
            fill="none"
            stroke="currentColor"
            opacity="0.4"
          />
          <rect x="2" y="2" width="17" height="8" rx="1.8" fill="currentColor" />
          <rect x="24" y="4" width="1.5" height="4" rx="0.7" fill="currentColor" opacity="0.4" />
        </svg>
      </span>
    </div>
  );
}

const OnlyCtx = createContext<string | null>(null);

function Phone({ children, label, note }: { children: ReactNode; label?: string; note?: string }) {
  const only = useContext(OnlyCtx);
  if (only && label && only !== label) return null;
  return (
    <figure data-name={`frame/${label ?? "prototype"}`} className="shrink-0">
      {label && (
        <figcaption className="mb-3 flex items-baseline gap-3">
          <span className={`${MONO} text-ink`}>{label}</span>
          {note && <span className={`${MONO} text-muted`}>{note}</span>}
        </figcaption>
      )}
      <div
        className="relative h-[844px] w-[390px] overflow-hidden rounded-[52px] border border-ink bg-paper [transform:translateZ(0)]"
        style={{ "--sat": "54px", "--sab": "34px" } as CSSProperties}
      >
        {children}
        <StatusBar />
        <span
          data-name="ios/home-indicator"
          className="pointer-events-none absolute bottom-2 left-1/2 z-50 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-ink"
        />
      </div>
    </figure>
  );
}

/* ---------- board: every frame side by side ---------- */
function Local({
  children,
}: {
  children: (s: {
    height: number;
    setHeight: (n: number) => void;
    wallH: number;
    setWallH: (n: number) => void;
    angle: Angle;
    setAngle: (a: Angle) => void;
  }) => ReactNode;
}) {
  const [height, setHeight] = useState(1.75);
  const [wallH, setWallH] = useState(4.0);
  const [angle, setAngle] = useState<Angle>("vertical");
  return <>{children({ height, setHeight, wallH, setWallH, angle, setAngle })}</>;
}

function Row({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section data-name={`board/screen-${n}`} className="border-t border-ink pt-6 pb-16">
      <header className="mb-8 flex items-baseline gap-6">
        <span className={`${MONO} text-accent-ink`}>Screen {n} / 4</span>
        <h2 className="font-display text-[32px] leading-none font-bold tracking-[0.005em]">
          {title}
        </h2>
      </header>
      <div className="flex gap-12 overflow-x-auto pb-4">{children}</div>
    </section>
  );
}

function Board() {
  const review = (p: ReviewPreset) => <ReviewScreen photo={WALL} preset={p} />;
  const live = (v: Voice) => (
    <Local>
      {(s) => <LiveScreen photo={WALL} height={s.height} wallH={s.wallH} voice={v} move={4} />}
    </Local>
  );
  return (
    <>
      <Row n="1" title="Upload">
        <Phone label="1A" note="Empty">
          <UploadScreen />
        </Phone>
        <Phone label="1B" note="How it works sheet">
          <UploadScreen initialSheet />
        </Phone>
        <Phone label="1C" note="Finding holds">
          <UploadScreen photo={WALL} />
        </Phone>
      </Row>
      <Row n="2" title="Review holds and route">
        <Phone label="2A" note="Holds drawn">
          {review("empty")}
        </Phone>
        <Phone label="2B" note="Route selected">
          {review("route")}
        </Phone>
        <Phone label="2C" note="Confirm hold sheet">
          {review("confirm")}
        </Phone>
        <Phone label="2D" note="Other... all types">
          {review("other")}
        </Phone>
      </Row>
      <Row n="3" title="Route and climber">
        <Phone label="3A" note="Form">
          <Local>{(s) => <RouteScreen photo={WALL} {...s} />}</Local>
        </Phone>
        <Phone label="3B" note="Solving">
          <Local>{(s) => <RouteScreen photo={WALL} {...s} solving />}</Local>
        </Phone>
      </Row>
      <Row n="4" title="Play">
        <Phone label="4A" note="Playback">
          <Local>
            {(s) => (
              <PlayScreen
                photo={WALL}
                height={s.height}
                setHeight={s.setHeight}
                wallH={s.wallH}
                angle={s.angle}
              />
            )}
          </Local>
        </Phone>
        <Phone label="4B" note="Live · idle">
          {live("idle")}
        </Phone>
        <Phone label="4C" note="Live · listening">
          {live("listening")}
        </Phone>
        <Phone label="4D" note="Live · speaking">
          {live("speaking")}
        </Phone>
      </Row>
    </>
  );
}

export default function App() {
  const phone = useMedia("(max-width: 520px), (pointer: coarse) and (max-width: 1024px)");
  const only = new URLSearchParams(window.location.search).get("frame")?.toUpperCase() ?? null;
  if (only)
    return (
      <OnlyCtx.Provider value={only}>
        <div className="flex min-h-screen justify-center bg-paper p-4 [&>section]:border-0 [&>section]:p-0 [&>section>header]:hidden">
          <Board />
        </div>
      </OnlyCtx.Provider>
    );
  const [view, setView] = useState<"board" | "prototype">("board");

  if (phone)
    return (
      <div
        data-name="device"
        className="fixed inset-0 overflow-hidden bg-paper"
        style={
          {
            "--sat": "max(env(safe-area-inset-top), 12px)",
            "--sab": "max(env(safe-area-inset-bottom), 12px)",
          } as CSSProperties
        }
      >
        <Flow />
      </div>
    );

  return (
    <div data-name="board" className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-[60] flex items-center justify-between border-b border-hairline bg-paper px-16 py-4">
        <div className="flex items-baseline gap-6">
          <Wordmark />
          <span className={`${MONO} text-muted`}>Mobile · 390 x 844 · 4 screens</span>
        </div>
        <div
          role="tablist"
          className="grid grid-cols-2 overflow-hidden rounded-[6px] border border-ink"
        >
          {(["board", "prototype"] as const).map((v, i) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`${MONO} h-12 px-5 ${i ? "border-l border-ink" : ""} ${view === v ? "bg-ink text-surface" : "text-ink"}`}
            >
              {v === "board" ? "All frames" : "Prototype"}
            </button>
          ))}
        </div>
      </header>
      {view === "board" ? (
        <main className="px-16 pt-12">
          <Board />
        </main>
      ) : (
        <main className="flex flex-col items-center gap-6 px-16 py-12">
          <Phone>
            <Flow />
          </Phone>
          <p className={`${MONO} text-muted`}>Tap through: pick an example wall to start</p>
        </main>
      )}
    </div>
  );
}
