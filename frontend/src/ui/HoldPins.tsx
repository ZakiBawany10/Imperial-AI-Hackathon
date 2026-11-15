// Custom hold illustrations used as "pins": a bolted-down hold on each corner
// of the photo sheet. Flat colour, ink outline, a bolt through the middle.

import { C } from "../lib/wall";

export type PinKind = "jug" | "pinch" | "sloper" | "crimp";

export const BODY: Record<PinKind, string> = {
  jug: "M10 36C8 22 20 10 34 10C50 10 58 22 55 36C53 48 44 56 32 55C20 55 11 48 10 36Z",
  pinch: "M24 6C38 4 46 14 44 32C43 48 38 58 28 58C18 58 16 46 17 32C18 18 16 8 24 6Z",
  sloper: "M5 46C6 24 20 10 34 10C48 10 59 24 59 46C59 52 54 54 48 54L16 54C9 54 5 52 5 46Z",
  crimp: "M6 26C6 20 12 18 20 18L46 16C54 16 58 20 58 26L58 40C58 46 52 48 44 48L18 49C10 49 6 45 6 40Z",
};

// Surface detail: finger bowl, squeeze line, friction contours, edge lip.
export const DETAIL: Record<PinKind, string> = {
  jug: "M18 29C23 21 42 20 47 29C42 35 24 36 18 29Z",
  pinch: "M23 14C30 13 35 19 34 32",
  sloper: "M13 44C16 30 25 21 34 21C43 21 51 30 52 44 M22 46C24 38 28 33 34 33C40 33 44 38 46 46",
  crimp: "M11 25L53 22",
};

/** The hold drawing itself, in a 64 x 64 box: flat colour, ink outline, surface
 *  detail, a chalky highlight, and either the bolt or a tick in the middle. */
export function HoldGlyph({
  kind,
  colour,
  mark = "bolt",
  faded = false,
}: {
  kind: PinKind;
  colour: string;
  mark?: "bolt" | "tick" | "none";
  /** outline at half strength, for holds still to come */
  faded?: boolean;
}) {
  const ink = { stroke: C.ink, strokeOpacity: faded ? 0.45 : 1 };
  return (
    <>
      <path d={BODY[kind]} fill={colour} {...ink} strokeWidth={2.4} strokeLinejoin="round" />
      {mark !== "tick" &&
        (kind === "jug" ? (
          <path d={DETAIL.jug} fill={C.ink} fillOpacity={faded ? 0.1 : 0.22} {...ink} strokeWidth={1.6} />
        ) : (
          <path
            d={DETAIL[kind]}
            fill="none"
            stroke={C.ink}
            strokeOpacity={faded ? 0.25 : 0.45}
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        ))}
      {/* chalky highlight */}
      <path
        d="M16 22C19 15 26 12 32 12"
        fill="none"
        stroke={C.surface}
        strokeOpacity={0.55}
        strokeWidth={3}
        strokeLinecap="round"
      />
      {mark === "bolt" && (
        <>
          <circle cx={32} cy={33} r={5.2} fill={C.surface} stroke={C.ink} strokeWidth={2} />
          <path d="M29.2 35.8L34.8 30.2" stroke={C.ink} strokeWidth={1.8} strokeLinecap="round" />
        </>
      )}
      {mark === "tick" && (
        // a chunky chalk-white tick, inked like the outline
        <>
          <path d="M20 33.5L28.5 42L45 24" fill="none" stroke={C.ink} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M20 33.5L28.5 42L45 24" fill="none" stroke={C.surface} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </>
  );
}

/** "Done": a bolted hold with a tick through it. */
export function HoldTick({
  size = 20,
  kind = "jug",
  colour = C.accent,
  className = "",
}: {
  size?: number;
  kind?: PinKind;
  colour?: string;
  className?: string;
}) {
  return (
    <svg data-name="icon/hold-tick" aria-hidden viewBox="0 0 64 64" width={size} height={size} className={className}>
      <HoldGlyph kind={kind} colour={colour} mark="tick" />
    </svg>
  );
}

export function HoldPin({
  kind,
  colour,
  size = 52,
  rotate = 0,
  className = "",
}: {
  kind: PinKind;
  colour: string;
  size?: number;
  rotate?: number;
  className?: string;
}) {
  return (
    <svg
      data-name={`pin/${kind}`}
      aria-hidden
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`pointer-events-none absolute z-10 ${className}`}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      <HoldGlyph kind={kind} colour={colour} />
    </svg>
  );
}
