import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { C, HOLD_COLOURS, holdPath, unsplash, type Hold } from "../lib/wall";

export const MONO = "font-mono text-[12px] font-medium uppercase tracking-[0.14em]";

export function Screen({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div
      data-name={name}
      className="absolute inset-0 flex flex-col overflow-hidden bg-paper text-ink"
      style={{ paddingTop: "var(--sat)" }}
    >
      {children}
    </div>
  );
}

const STEPS = ["Upload", "Review", "Route", "Play"];
export function TopBar({ step, right }: { step: number; right?: ReactNode }) {
  return (
    <header data-name="topbar" className="shrink-0 bg-paper px-6 pt-2 pb-4">
      <div className="flex h-10 items-center justify-between gap-4">
        <span
          data-name="topbar/wordmark"
          className="font-display text-[20px] font-bold tracking-[-0.03em]"
        >
          BetaCrux
        </span>
        {right ?? (
          <span data-name="topbar/step-label" className={`${MONO} text-muted`}>
            Step {step} / 4<span className="ml-3 text-ink">{STEPS[step - 1]}</span>
          </span>
        )}
      </div>
      <div
        data-name="topbar/progress"
        className="mt-2 grid grid-cols-4 items-center gap-2"
        aria-label={`Step ${step} of 4`}
      >
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={i <= step ? "h-[2px] bg-ink" : "h-px bg-hairline"} />
        ))}
      </div>
    </header>
  );
}

export function StickyBar({
  children,
  name = "bottom-bar",
}: {
  children: ReactNode;
  name?: string;
}) {
  return (
    <div
      data-name={name}
      className="relative z-20 mt-auto shrink-0 border-t border-hairline bg-paper px-6 pt-4"
      style={{ paddingBottom: "calc(var(--sab) + 8px)" }}
    >
      {children}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "text";
  size?: "lg" | "md";
  name?: string;
};
export function Btn({ variant = "primary", size = "lg", name, className = "", ...rest }: BtnProps) {
  const base = `inline-flex select-none items-center justify-center gap-2 rounded-[6px] text-[16px] font-semibold transition-[transform,background-color] active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${size === "lg" ? "h-14 px-6" : "h-12 px-5"}`;
  const v =
    variant === "primary"
      ? "bg-accent text-surface active:bg-ink disabled:bg-hairline disabled:text-muted disabled:active:translate-y-0"
      : variant === "outline"
        ? "border border-ink text-ink active:bg-ink active:text-surface"
        : "text-ink underline decoration-hairline underline-offset-4 active:decoration-ink";
  return (
    <button
      data-name={name ?? `button/${variant}`}
      className={`${base} ${v} ${className}`}
      {...rest}
    />
  );
}

export function BottomSheet({
  open,
  onClose,
  children,
  name,
  tall = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  name: string;
  tall?: boolean;
}) {
  const [shown, setShown] = useState(open);
  const [entered, setEntered] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
      return () => cancelAnimationFrame(r);
    }
    setEntered(false);
    const t = setTimeout(() => setShown(false), 220);
    return () => clearTimeout(t);
  }, [open]);
  if (!shown) return null;
  return (
    <div data-name={name} className="absolute inset-0 z-40">
      <button
        aria-label="Close"
        onClick={onClose}
        className={`absolute inset-0 bg-ink/35 transition-opacity duration-200 ${entered ? "opacity-100" : "opacity-0"}`}
      />
      <div
        role="dialog"
        className={`absolute inset-x-0 bottom-0 flex flex-col rounded-t-[4px] border-t border-ink bg-surface transition-transform duration-200 ${entered ? "translate-y-0" : "translate-y-full"} ${tall ? "top-[calc(var(--sat)+24px)]" : "max-h-[78%]"}`}
        style={{ paddingBottom: "calc(var(--sab) + 8px)" }}
      >
        <div className="flex h-6 shrink-0 items-center justify-center">
          <span className="h-1 w-10 rounded-full bg-hairline" />
        </div>
        {children}
      </div>
    </div>
  );
}

/** Wall photo with an SVG layer in shared 1000 x 1000 wall coordinates. */
export function WallPhoto({
  photo,
  children,
  dim = 0,
  name = "photo/wall",
}: {
  photo: string;
  children?: ReactNode;
  dim?: number;
  name?: string;
}) {
  const src = photo.startsWith("blob:") || photo.startsWith("http") ? photo : unsplash(photo);
  return (
    <div data-name={name} className="absolute inset-0 overflow-hidden bg-hairline">
      <img
        src={src}
        alt="Bouldering wall"
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ filter: "grayscale(0.75) contrast(0.92) brightness(1.04)" }}
      />
      <div className="absolute inset-0 bg-paper/25" />
      {dim > 0 && <div className="absolute inset-0 bg-ink" style={{ opacity: dim }} />}
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
      >
        {children}
      </svg>
    </div>
  );
}

export function HoldShape({
  hold,
  opacity = 1,
  stroke = C.ink,
  strokeWidth = 1.5,
  scale = 1,
}: {
  hold: Hold;
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
  scale?: number;
}) {
  return (
    <path
      d={holdPath(hold, scale)}
      fill={HOLD_COLOURS[hold.colour]}
      fillOpacity={0.88}
      stroke={stroke}
      strokeWidth={strokeWidth}
      vectorEffect="non-scaling-stroke"
      opacity={opacity}
      style={{ transition: "opacity 200ms" }}
    />
  );
}

export function Tape({ className = "", rotate = -36 }: { className?: string; rotate?: number }) {
  return (
    <span
      data-name="tape"
      aria-hidden
      className={`absolute z-10 h-6 w-20 bg-accent/85 ${className}`}
      style={{ transform: `rotate(${rotate}deg)` }}
    />
  );
}

export function Flame({ className = "size-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 14" className={className} aria-hidden>
      <path
        d="M6 0.5C6.6 3 9.5 4.4 9.5 8.2A3.5 3.5 0 0 1 2.5 8.2C2.5 6.4 3.5 5.4 4.2 4.6C4.3 6 5 6.8 5.8 6.9C5.4 4.7 5.6 2.4 6 0.5Z"
        fill={C.accent}
      />
    </svg>
  );
}

export function Glyph({
  kind,
  className = "size-5",
}: {
  kind: "play" | "pause" | "prev" | "next" | "minus" | "plus" | "close";
  className?: string;
}) {
  const p = { fill: "currentColor" };
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden>
      {kind === "play" && <path d="M6 3.5L16.5 10L6 16.5Z" {...p} />}
      {kind === "pause" && (
        <>
          <rect x="5" y="3.5" width="3.5" height="13" {...p} />
          <rect x="11.5" y="3.5" width="3.5" height="13" {...p} />
        </>
      )}
      {kind === "prev" && (
        <>
          <rect x="3.5" y="4" width="2" height="12" {...p} />
          <path d="M16 4L6.5 10L16 16Z" {...p} />
        </>
      )}
      {kind === "next" && (
        <>
          <rect x="14.5" y="4" width="2" height="12" {...p} />
          <path d="M4 4L13.5 10L4 16Z" {...p} />
        </>
      )}
      {kind === "minus" && <rect x="4" y="9.25" width="12" height="1.5" {...p} />}
      {kind === "plus" && (
        <path d="M9.25 4h1.5v5.25H16v1.5h-5.25V16h-1.5v-5.25H4v-1.5h5.25Z" {...p} />
      )}
      {kind === "close" && (
        <path d="M5 4L10 9L15 4L16 5L11 10L16 15L15 16L10 11L5 16L4 15L9 10L4 5Z" {...p} />
      )}
    </svg>
  );
}

/** Vertical scale bar with metre ticks, drawn along the left edge of a photo. */
export function MeasureLine({ metres }: { metres: number }) {
  const ticks = Math.floor(metres * 2);
  return (
    <div
      data-name="photo/measure-line"
      className="pointer-events-none absolute top-4 bottom-4 left-3 z-10 flex w-10 items-center"
    >
      <div className="relative h-full w-3">
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-surface" />
        {Array.from({ length: ticks + 1 }, (_, i) => (
          <span
            key={i}
            className="absolute left-1/2 h-px -translate-x-1/2 bg-surface"
            style={{ bottom: `${((i * 0.5) / metres) * 100}%`, width: i % 2 === 0 ? 12 : 6 }}
          />
        ))}
        <span className="absolute top-0 left-1/2 h-px w-3 -translate-x-1/2 bg-surface" />
      </div>
      <span
        className={`${MONO} -ml-1 rounded-[4px] bg-ink px-1.5 py-0.5 text-[12px] text-surface`}
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
      >
        {metres.toFixed(1)} M
      </span>
    </div>
  );
}

/** Chunky slider: 8px track, 32px thumb, native range input on top for touch + a11y. */
export function Slider({
  id,
  value,
  min,
  max,
  step,
  onChange,
  label,
  compact = false,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  label: string;
  compact?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div data-name="slider" className={`relative ${compact ? "h-10" : "h-12"}`}>
      <div className="absolute inset-x-4 top-1/2 h-2 -translate-y-1/2 rounded-[4px] bg-hairline">
        <div className="h-full rounded-[4px] bg-ink" style={{ width: `${pct}%` }} />
        <span
          className="absolute top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-surface bg-accent outline outline-1 outline-ink"
          style={{ left: `${pct}%` }}
        />
      </div>
      <input
        id={id}
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}
