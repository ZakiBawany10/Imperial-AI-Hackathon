import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { PHOTOS } from "./lib/wall";
import { MONO } from "./ui/kit";
import { UploadScreen } from "./screens/Upload";
import { ReviewScreen, type ReviewPreset } from "./screens/Review";
import { RouteScreen, type Angle } from "./screens/Route";
import { LiveScreen, PlayScreen, type Voice } from "./screens/Play";

const WALL = PHOTOS.wall01;

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

function Flow() {
  const [step, setStep] = useState<Step>("upload");
  const [photo, setPhoto] = useState<string>(WALL);
  const [height, setHeight] = useState(1.75);
  const [wallH, setWallH] = useState(4.0);
  const [angle, setAngle] = useState<Angle>("vertical");
  const [move, setMove] = useState(4);
  const toReview = useCallback(() => setStep("review"), []);
  const toPlay = useCallback(() => setStep("play"), []);

  switch (step) {
    case "upload":
    case "finding":
      return (
        <UploadScreen
          photo={step === "finding" ? photo : null}
          onPhoto={(p) => {
            setPhoto(p);
            setStep("finding");
          }}
          onCancel={() => setStep("upload")}
          onFound={toReview}
        />
      );
    case "review":
      return <ReviewScreen photo={photo} onNext={() => setStep("route")} />;
    case "route":
    case "solving":
      return (
        <RouteScreen
          {...{ photo, height, setHeight, wallH, setWallH, angle, setAngle }}
          solving={step === "solving"}
          onSolve={() => setStep("solving")}
          onCancel={() => setStep("route")}
          onSolved={toPlay}
        />
      );
    case "play":
      return (
        <PlayScreen
          {...{ photo, height, setHeight, wallH, angle }}
          initialMove={move}
          onNewWall={() => setStep("upload")}
          onLive={(m) => {
            setMove(m);
            setStep("live");
          }}
        />
      );
    case "live":
      return <LiveScreen {...{ photo, height, wallH, move }} onExit={() => setStep("play")} />;
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
        <span className={`${MONO} text-accent`}>Screen {n} / 4</span>
        <h2 className="font-display text-[32px] leading-none font-bold tracking-[-0.03em]">
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
  const phone = useMedia("(max-width: 520px)");
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
        className="relative h-[100dvh] w-full overflow-hidden bg-paper"
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
          <span className="font-display text-[20px] font-bold tracking-[-0.03em]">BetaCrux</span>
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
