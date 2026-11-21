/**
 * Shared, render-free state for the landing film: the page writes scroll progress, the 3D scene
 * reads it every frame. A plain object avoids re-rendering React on every scroll tick.
 */
export const film = { target: 0, p: 0 };

const RAW = [
  { key: "care", n: "I", title: "Care" },
  { key: "reasoning", n: "II", title: "Reasoning" },
  { key: "codes", n: "III", title: "Codes" },
  { key: "submitted", n: "IV", title: "Submitted" },
  { key: "declined", n: "V", title: "Declined" },
  { key: "region", n: "VI", title: "The region" },
  { key: "seal", n: "VII", title: "SEAL" },
  { key: "question", n: "VIII", title: "The question" },
  { key: "accepted", n: "IX", title: "Accepted" },
  { key: "numbers", n: "", title: "" },
  { key: "partners", n: "", title: "" },
  { key: "ending", n: "", title: "" },
] as const;

/** The film's chapters, each starting at an equal share of the page scroll. */
export const CHAPTERS = RAW.map((c, i) => ({ ...c, at: i / RAW.length }));
export type ChapterKey = (typeof RAW)[number]["key"];
export const AT = Object.fromEntries(CHAPTERS.map((c) => [c.key, c.at])) as Record<ChapterKey, number>;
/** One chapter's share of the scroll. */
export const STEP = 1 / RAW.length;

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** 0 → 1 as p moves from a to b (eased). */
export const span = (p: number, a: number, b: number) => smooth((p - a) / (b - a));
/** Rises over [a, b], holds, falls over [c, d]. */
export const window4 = (p: number, a: number, b: number, c: number, d: number) => span(p, a, b) * (1 - span(p, c, d));
