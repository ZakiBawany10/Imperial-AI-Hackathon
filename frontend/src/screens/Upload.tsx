import { useEffect, useRef, useState, type ReactNode } from "react";
import { HOLDS, PHOTOS, unsplash } from "../lib/wall";
import { BottomSheet, Btn, MONO, Screen, StickyBar, TopBar, WallPhoto } from "../ui/kit";
import { HoldPin } from "../ui/HoldPins";
import { C } from "../lib/wall";

const EXAMPLES = [
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
  onPhoto?: (src: string) => void;
  onCancel?: () => void;
  onFound?: () => void;
};

export function UploadScreen({ photo, initialSheet = false, onPhoto, onCancel, onFound }: Props) {
  const [howOpen, setHowOpen] = useState(initialSheet);
  const camRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const finding = !!photo;

  const file = (f?: File) => {
    if (f && f.type.startsWith("image/")) onPhoto?.(URL.createObjectURL(f));
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
            We find every hold, solve the route for your height, and tell you the grade.
          </p>
        </div>

        <div className="mt-6 px-6">
          {finding ? (
            <FindingSheet photo={photo!} onFound={onFound} />
          ) : (
            <EmptySheet onTap={() => pickRef.current?.click()} />
          )}
        </div>

        {!finding && (
          <>
            <div data-name="examples" className="mt-8">
              <p className="px-6 text-[14px] text-muted">Or try an example wall</p>
              <ul className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-2 [scrollbar-width:none]">
                {EXAMPLES.map((e) => (
                  <li key={e.id} className="shrink-0 snap-start">
                    <button
                      data-name={`examples/thumb-${e.id}`}
                      onClick={() => onPhoto?.(e.photo)}
                      className="block text-left active:opacity-70"
                    >
                      <span className="block size-20 overflow-hidden rounded-[4px] border border-hairline bg-surface">
                        <img
                          src={unsplash(e.photo, 200)}
                          alt={`Example ${e.label}`}
                          className="h-full w-full object-cover"
                        />
                      </span>
                      <span className={`${MONO} mt-2 block text-muted`}>{e.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
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
              Finding holds
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
        <p className={`${MONO} mt-3 text-center text-[12px] text-muted`}>
          Straight-on, whole wall, good light
        </p>
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
                <span className={`${MONO} w-6 pt-1 text-accent`}>0{i + 1}</span>
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
      <HoldPin kind="jug" colour={C.yellow} size={56} rotate={-14} className="-top-5 -left-4" />
      <HoldPin kind="pinch" colour={C.blue} size={52} rotate={18} className="-top-5 -right-3" />
      <HoldPin kind="sloper" colour={C.accent} size={54} rotate={8} className="-bottom-5 -left-3" />
      <HoldPin kind="crimp" colour={C.green} size={50} rotate={-10} className="-right-3 -bottom-4" />
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
        className="absolute inset-0 flex items-center justify-center active:bg-ink/5"
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

function FindingSheet({ photo, onFound }: { photo: string; onFound?: () => void }) {
  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [n, setN] = useState(reduce ? FOUND_ORDER.length : 0);
  useEffect(() => {
    if (n >= FOUND_ORDER.length) {
      if (!onFound) return;
      const t = setTimeout(onFound, 900);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setN((v) => v + 1), n === 0 ? 500 : 110);
    return () => clearTimeout(t);
  }, [n, onFound]);
  const done = n >= FOUND_ORDER.length;
  return (
    <div data-name="upload/finding">
      <PinnedSheet name="upload/photo-sheet">
        <WallPhoto photo={photo}>
          {FOUND_ORDER.slice(0, n).map((h, i) => (
            <g key={h.id} className="anim-pop" style={{ transformOrigin: `${h.x}px ${h.y}px` }}>
              <circle cx={h.x} cy={h.y} r={30} fill="#E8431F" stroke="#FBF8F2" strokeWidth={5} />
              <text
                x={h.x}
                y={h.y + 9}
                textAnchor="middle"
                fill="#FBF8F2"
                fontFamily="Barlow Semi Condensed"
                fontSize={26}
                fontWeight={500}
              >
                {i + 1}
              </text>
            </g>
          ))}
        </WallPhoto>
        {!done && <span aria-hidden className="anim-scan absolute inset-x-0 h-px bg-surface" />}
      </PinnedSheet>
      <div className="mt-6 flex items-center justify-between" aria-live="polite">
        <p data-name="finding/caption" className={`${MONO} flex items-center gap-2`}>
          <span
            className={`inline-block size-1.5 rounded-full bg-accent ${done ? "" : "anim-blink"}`}
            aria-hidden
          />
          Finding holds... {n} found
        </p>
        <span className={`${MONO} text-muted`}>
          {done ? "Done" : `${Math.round((n / FOUND_ORDER.length) * 100)}%`}
        </span>
      </div>
    </div>
  );
}

/* Faint line drawing of a bolted wall with hold outlines and setter tags. */
function WallSketch() {
  const bolts: [number, number][] = [];
  for (let x = 40; x < 400; x += 40) for (let y = 40; y < 440; y += 40) bolts.push([x, y]);
  const tag = "font-mono text-[11px] font-medium tracking-[0.12em]";
  return (
    <svg
      data-name="upload/wall-drawing"
      viewBox="0 0 400 440"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden
    >
      <g stroke="#D9D2C3" fill="none">
        <line x1="200" y1="0" x2="200" y2="440" />
        <line x1="0" y1="220" x2="400" y2="220" />
        <line x1="0" y1="400" x2="400" y2="400" />
      </g>
      <g fill="#D9D2C3">
        {bolts.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />
        ))}
      </g>
      <g stroke="#1B1A17" strokeOpacity="0.32" strokeWidth="1.25" fill="none">
        <circle cx="90" cy="350" r="13" />
        <rect x="140" y="292" width="36" height="20" rx="9" transform="rotate(-12 158 302)" />
        <circle cx="96" cy="240" r="9" />
        <rect x="250" y="300" width="28" height="28" rx="8" />
        <circle cx="300" cy="200" r="15" />
        <circle cx="330" cy="360" r="10" />
        <rect x="300" y="96" width="32" height="22" rx="9" transform="rotate(-20 316 107)" />
        <circle cx="180" cy="110" r="13" />
        <circle cx="70" cy="90" r="9" />
        <path d="M 200 170 q 16 -12 30 2 q 6 14 -10 20 q -22 4 -20 -22 z" />
      </g>
      <g stroke="#1B1A17" strokeOpacity="0.4">
        <line x1="103" y1="350" x2="124" y2="372" />
        <line x1="315" y1="200" x2="338" y2="184" />
        <line x1="193" y1="110" x2="216" y2="94" />
      </g>
      <g fill="#6B665C" className={tag}>
        <text x="134" y="380">
          A1
        </text>
        <text x="348" y="186">
          B4
        </text>
        <text x="226" y="96">
          C2
        </text>
      </g>
      <circle cx="128" cy="376" r="3" fill="#2F6FDE" />
      <circle cx="342" cy="182" r="3" fill="#E8B100" />
      <circle cx="220" cy="92" r="3" fill="#2E8B57" />
      <g stroke="#1B1A17" strokeOpacity="0.45">
        <line x1="22" y1="40" x2="22" y2="400" />
        <line x1="16" y1="40" x2="28" y2="40" />
        <line x1="16" y1="400" x2="28" y2="400" />
      </g>
      <text
        transform="translate(38 220) rotate(-90)"
        fill="#6B665C"
        textAnchor="middle"
        className={tag}
      >
        4.0 M
      </text>
    </svg>
  );
}
