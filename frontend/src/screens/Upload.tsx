import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HOLDS, PHOTOS, unsplash, type Hold } from "../lib/wall";
import { BottomSheet, Btn, MONO, Screen, StickyBar, TopBar, WallPhoto } from "../ui/kit";
import { HoldPin } from "../ui/HoldPins";
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

      <BottomSheet name="sheet/how-it-works" open={howOpen} onClose={() => setHowOpen(false)}>
        <div className="px-6 pb-2">
          <p className={`${MONO} text-muted`}>How it works</p>
          <h2 className="mt-2 font-display text-[32px] leading-none font-bold tracking-[0.005em]">
            Three steps, one photo.
          </h2>
          <ol className="mt-6 border-t border-hairline">
            {[
              ["Find holds", "Every hold on the wall, outlined and tagged."],
              ["Pick a route", "Tap one hold to select its whole colour."],
              ["Solve and grade", "Beta for your height, and the grade it climbs at."],
            ].map(([t, d], i) => (
              <li
                key={t}
                data-name={`how-it-works/step-0${i + 1}`}
                className="flex gap-6 border-b border-hairline py-4"
              >
                <span className={`${MONO} w-6 pt-1 text-accent-ink`}>0{i + 1}</span>
                <span>
                  <span className="block text-[16px] font-semibold">{t}</span>
                  <span className="block text-[14px] text-muted">{d}</span>
                </span>
              </li>
            ))}
          </ol>
          <Btn
            variant="outline"
            size="md"
            className="mt-6 w-full"
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
    <div data-name={name} className="relative" style={{ transform: "rotate(-0.8deg)" }}>
      <HoldPin kind="jug" colour={C.accent} size={56} rotate={-14} className="-top-5 -left-4" />
      <HoldPin kind="pinch" colour={C.surface} size={52} rotate={18} className="-top-5 -right-3" />
      <HoldPin kind="sloper" colour={C.ink} size={54} rotate={8} className="-bottom-5 -left-3" />
      <HoldPin kind="crimp" colour={C.accent} size={50} rotate={-10} className="-right-3 -bottom-4" />
      <div className="relative h-[340px] overflow-hidden rounded-[4px] border border-dashed border-ink bg-surface">
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
        className="absolute inset-0 flex items-end justify-center pb-6 active:bg-ink/5"
        aria-label="Choose a photo of the wall"
      >
        <span
          data-name="upload/label"
          className="rounded-[4px] border border-hairline bg-surface px-5 py-3 text-center"
        >
          <span className="block font-display text-[20px] font-bold tracking-[0.005em]">
            Drop a photo here
          </span>
          <span className={`${MONO} mt-1 block text-muted`}>or tap to browse</span>
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

