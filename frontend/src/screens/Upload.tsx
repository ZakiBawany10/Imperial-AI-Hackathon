import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HOLDS, PHOTOS, unsplash, type Hold } from "../lib/wall";
import { BottomSheet, Btn, MONO, Screen, StickyBar, TopBar, WallPhoto } from "../ui/kit";
import { HoldGlyph } from "../ui/HoldPins";
import { WallSketch } from "../ui/WallSketch";
import { C } from "../lib/wall";

export type Example = { id: string; label: string; photo: string; credit?: string };
const EXAMPLES: Example[] = [
  { id: "wall-01", label: "Wall 01", photo: PHOTOS.wall01 },
  { id: "wall-02", label: "Wall 02", photo: PHOTOS.wall02 },
  { id: "wall-03", label: "Wall 03", photo: PHOTOS.wall03 },
  { id: "wall-04", label: "Wall 04", photo: "1696105539018-a73a53770934" },
];

// Detection order: bottom of the wall upward, like a scan.
const FOUND_ORDER = [...HOLDS].sort((a, b) => b.y - a.y);

type Props = {
  photo?: string | null;
  initialSheet?: boolean;
  /** `file` is set for a photo the user picked, unset for an example. */
  onPhoto?: (src: string, file?: File) => void;
  onCancel?: () => void;
  onFound?: () => void;
  examples?: Example[];
  /** Real detection (prototype flow). `found` stays null while /analyze runs. */
  real?: { found: { holds: Hold[]; aspect: number } | null; aspect?: number; error?: string | null };
  /** offered when detection failed */
  onExample?: () => void;
};

const srcOf = (p: string) =>
  p.startsWith("/") || p.startsWith("blob:") || p.startsWith("http") || p.startsWith("data:")
    ? p
    : unsplash(p, 200);

export function UploadScreen({
  photo,
  initialSheet = false,
  onPhoto,
  onCancel,
  onFound,
  examples = EXAMPLES,
  real,
  onExample,
}: Props) {
  const [howOpen, setHowOpen] = useState(initialSheet);
  const camRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const finding = !!photo;

  const file = (f?: File) => {
    if (f && f.type.startsWith("image/")) onPhoto?.(URL.createObjectURL(f), f);
  };

  return (
    <Screen name="screen/1-upload">
      <TopBar step={1} />
      <div data-name="upload/scroll" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-6 pt-4">
          <h1
            data-name="upload/headline"
            className="font-display text-[40px] leading-[1.02] font-bold tracking-[0.005em]"
          >
            Photograph the wall.
          </h1>
          <p data-name="upload/body" className="mt-3 text-[16px] leading-[1.45] text-muted">
            See how you'd climb it, and what it grades.
          </p>
        </div>

        <div className="mt-6 px-6">
          {finding ? (
            <FindingSheet photo={photo!} onFound={onFound} real={real} onExample={onExample} />
          ) : (
            <EmptySheet onTap={() => pickRef.current?.click()} />
          )}
        </div>

        {!finding && (
          <>
            <div data-name="examples" className="mt-8">
              <p className="px-6 text-[14px] text-muted">Or try an example wall</p>
              <ul className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-2 [scrollbar-width:none]">
                {examples.map((e) => (
                  <li key={e.id} className="shrink-0 snap-start">
                    <button
                      data-name={`examples/thumb-${e.id}`}
                      onClick={() => onPhoto?.(e.photo)}
                      className="block text-left active:opacity-70"
                    >
                      <span className="block size-20 overflow-hidden rounded-[4px] border border-hairline bg-surface">
                        <img
                          src={srcOf(e.photo)}
                          alt={`Example ${e.label}`}
                          className="h-full w-full object-cover"
                        />
                      </span>
                      <span className={`${MONO} mt-2 block text-muted`}>{e.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {[...new Set(examples.map((e) => e.credit).filter(Boolean))].map((c) => (
                <p key={c} data-name="examples/credit" className="px-6 pt-1 text-[12px] text-muted">
                  {c}
                </p>
              ))}
            </div>
            <div className="px-6 pt-2 pb-6">
              <button
                data-name="link/how-it-works"
                onClick={() => setHowOpen(true)}
                className={`${MONO} -ml-1 flex h-12 items-center gap-2 px-1 text-ink`}
              >
                <span className="inline-block size-1.5 rounded-full bg-accent" aria-hidden />
                <span className="underline decoration-hairline underline-offset-4">
                  How it works
                </span>
              </button>
            </div>
          </>
        )}
      </div>

      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => file(e.target.files?.[0])}
      />
      <input
        ref={pickRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => file(e.target.files?.[0])}
      />

      <StickyBar>
        {finding ? (
          <div className="flex flex-col gap-2">
            <Btn disabled className="w-full">
              {real?.error ? "No holds found" : "Finding holds"}
            </Btn>
            <Btn variant="outline" size="md" className="w-full" onClick={onCancel}>
              Use another photo
            </Btn>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Btn className="w-full" onClick={() => camRef.current?.click()}>
              Take photo
            </Btn>
            <Btn
              variant="outline"
              size="md"
              className="w-full"
              onClick={() => pickRef.current?.click()}
            >
              Choose a photo
            </Btn>
          </div>
        )}
      </StickyBar>

      <BottomSheet name="sheet/how-it-works" tall open={howOpen} onClose={() => setHowOpen(false)}>
        <div className="px-6 pb-2">
          <h2 className="font-josefin text-[30px] leading-none font-bold tracking-[0.01em]">
            How it works
          </h2>
          {/* the steps as a little route: a bolted hold each, joined by the beta line */}
          <ol data-name="how-it-works/route" className="relative mt-6">
            <span
              aria-hidden
              className="absolute top-6 bottom-10 left-[23px] border-l-2 border-dashed border-accent"
            />
            {(
              [
                ["jug", C.accent, "Find holds", "Every hold on the wall, outlined."],
                ["crimp", C.surface, "Pick a route", "Choose its colour from the list; we light it up and you fix any hold we missed."],
                ["sloper", C.ink, "Solve and grade", "Beta for your height, and the grade it climbs at."],
              ] as const
            ).map(([kind, colour, t, d], i) => (
              <li key={t} data-name={`how-it-works/step-0${i + 1}`} className="relative flex gap-4 pb-6">
                <span className="relative flex w-12 shrink-0 justify-center">
                  <svg viewBox="0 0 64 64" className="size-12" aria-hidden>
                    <HoldGlyph kind={kind} colour={colour} />
                  </svg>
                  {i === 2 && (
                    <span
                      className={`${MONO} absolute -bottom-2 left-0 rotate-[-8deg] bg-ink px-1.5 py-0.5 text-[9px] leading-none text-surface`}
                    >
                      Top
                    </span>
                  )}
                </span>
                <span className="pt-1.5">
                  <span className="block font-josefin text-[18px] leading-tight font-semibold">{t}</span>
                  <span className="mt-1 block text-[14px] leading-[1.4] text-muted">{d}</span>
                </span>
              </li>
            ))}
          </ol>
          <p data-name="how-it-works/access" className="text-[14px] leading-[1.45]">
            <span className="font-semibold">Colourblind? </span>
            Ascend reads each climb's colour from the photo and names it, and the voice coach tells you which hold to
            grab next, so you never have to tell colours apart.
          </p>
          <h3 className={`${MONO} mt-5 text-muted`}>How accurate it is</h3>
          <ul data-name="how-it-works/accuracy" className="mt-2 space-y-1.5 text-[14px] leading-[1.4]">
            <li><span className="font-semibold">95%</span> of holds found (50 test photos, 3,433 holds)</li>
            <li><span className="font-semibold">87%</span> of hold types right, 98% in the top three it offers</li>
            <li><span className="font-semibold">85%</span> match with the hand holds real climbers chose (22 recorded climbs)</li>
            <li><span className="font-semibold">1.3</span> grade steps off on average on board climbs; not yet measured on gym walls</li>
            <li><span className="font-semibold">95%</span> of holds stand out in the 3D wall</li>
            <li>Climb colours are grouped right about half the time, so you can fix them in one tap</li>
          </ul>
          <Btn
            variant="outline"
            size="md"
            className="mt-5 w-full"
            onClick={() => setHowOpen(false)}
          >
            Got it
          </Btn>
        </div>
      </BottomSheet>
    </Screen>
  );
}

function PinnedSheet({ children, name }: { children: ReactNode; name: string }) {
  return (
    <div data-name={name} className="relative">
      <div className="relative h-[340px] overflow-hidden rounded-[4px] bg-ink">
        {children}
      </div>
    </div>
  );
}

function EmptySheet({ onTap }: { onTap: () => void }) {
  return (
    <PinnedSheet name="upload/dropzone">
      <WallSketch />
      <button
        onClick={onTap}
        className="group absolute inset-0 flex items-end justify-center pb-5 active:bg-surface/5"
        aria-label="Choose a photo of the wall"
      >
        <span
          data-name="upload/label"
          className="flex items-center gap-3 rounded-[4px] bg-surface py-3 pr-5 pl-3.5 text-left shadow-[0_6px_20px_rgba(0,0,0,0.28)] transition-transform group-hover:-translate-y-0.5"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[3px] bg-accent/25 text-ink" aria-hidden>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
            </svg>
          </span>
          <span>
            <span className="block font-display text-[18px] leading-tight font-bold tracking-[0.005em]">
              Drop a photo here
            </span>
            <span className={`${MONO} mt-0.5 block text-muted`}>or tap to browse</span>
          </span>
        </span>
      </button>
    </PinnedSheet>
  );
}

function FindingSheet({
  photo,
  onFound,
  real,
  onExample,
}: {
  photo: string;
  onFound?: () => void;
  real?: Props["real"];
  onExample?: () => void;
}) {
  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Mock: the design's holds, one by one. Real: wait for /analyze, then pop its
  // holds bottom to top in about two seconds however many there are.
  const order = useMemo(
    () => (real ? [...(real.found?.holds ?? [])].sort((a, b) => b.y - a.y) : FOUND_ORDER),
    [real?.found], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const ready = !real || !!real.found;
  const stepBy = real ? Math.max(1, Math.ceil(order.length / 24)) : 1;
  const [n, setN] = useState(reduce && !real ? FOUND_ORDER.length : 0);
  useEffect(() => {
    if (!ready) return;
    if (n >= order.length) {
      if (!onFound) return;
      const t = setTimeout(onFound, 900);
      return () => clearTimeout(t);
    }
    const t = setTimeout(
      () => setN((v) => (reduce ? order.length : Math.min(order.length, v + stepBy))),
      n === 0 ? 500 : real ? 90 : 110,
    );
    return () => clearTimeout(t);
  }, [n, onFound, ready, order, stepBy, reduce, real]);
  const done = ready && n >= order.length;
  const error = real?.error;
  const pinR = real ? 13 : 30;
  return (
    <div data-name="upload/finding">
      <PinnedSheet name="upload/photo-sheet">
        <WallPhoto photo={photo} aspect={real?.found?.aspect ?? real?.aspect}>
          {order.slice(0, n).map((h, i) => (
            <g key={h.id} className="anim-pop" style={{ transformOrigin: `${h.x}px ${h.y}px` }}>
              <circle cx={h.x} cy={h.y} r={pinR} fill={C.accent} stroke={C.surface} strokeWidth={real ? 3 : 5} />
              {!real && (
                <text
                  x={h.x}
                  y={h.y + 9}
                  textAnchor="middle"
                  fill={C.surface}
                  fontFamily="Barlow Semi Condensed"
                  fontSize={26}
                  fontWeight={500}
                >
                  {i + 1}
                </text>
              )}
            </g>
          ))}
        </WallPhoto>
        {!done && !error && <span aria-hidden className="anim-scan absolute inset-x-0 h-px bg-surface" />}
      </PinnedSheet>
      {error ? (
        <div data-name="finding/error" role="alert" className="mt-6">
          <p className={`${MONO} flex items-center gap-2 text-alert`}>
            <span className="inline-block size-1.5 rounded-full bg-alert" aria-hidden />
            Couldn't find holds
          </p>
          <p className="mt-2 text-[16px] leading-[1.4]">{error}</p>
          {onExample && (
            <Btn variant="outline" size="md" className="mt-4 w-full" onClick={onExample}>
              Use the example wall
            </Btn>
          )}
        </div>
      ) : (
        <div className="mt-6 flex items-center justify-between" aria-live="polite">
          <p data-name="finding/caption" className={`${MONO} flex items-center gap-2`}>
            <span
              className={`inline-block size-1.5 rounded-full bg-accent ${done ? "" : "anim-blink"}`}
              aria-hidden
            />
            {ready ? `Finding holds... ${n} found` : "Finding holds..."}
          </p>
          <span className={`${MONO} text-muted`}>
            {done ? "Done" : ready ? `${Math.round((n / Math.max(1, order.length)) * 100)}%` : ""}
          </span>
        </div>
      )}
    </div>
  );
}

