/** Shared guardrail: a quote must be the note's own words. */
/** Compare quotes ignoring case, punctuation and spacing (the words must still be the note's own, in order). */
export const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}°/]+/gu, " ").replace(/\s+/g, " ").trim();
/** A quote may join note fragments with "…"; every fragment must be in the note. */
export const quoted = (evidence: string, note: string) => {
  const parts = evidence.split(/\.\.\.|…/).map(norm).filter((p) => p.length > 0);
  return parts.length > 0 && parts.every((p) => note.includes(p));
};
