/** Time helpers. Everything SEAL shows or files is in Dubai time (UTC+4, no DST). */
export const DAY = 86_400_000;
const DUBAI_OFFSET = 4 * 3600_000;

/** ISO string in Dubai time, e.g. "2026-11-20T09:30:00+04:00". */
export function dubaiIso(ms: number = Date.now()): string {
  return new Date(ms + DUBAI_OFFSET).toISOString().replace("Z", "+04:00").replace(/\.\d{3}/, "");
}

/** eClaimLink date-time "dd/mm/yyyy HH:MM" in Dubai time. */
export function eclaimDateTime(ms: number = Date.now()): string {
  const d = new Date(ms + DUBAI_OFFSET);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** Parse an eClaimLink "dd/mm/yyyy[ HH:MM]" (Dubai time) to epoch ms. */
export function parseEclaim(s: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{1,2}):(\d{1,2}))?$/.exec(s.trim());
  if (!m) throw new Error(`not an eClaimLink date: ${s}`);
  const [, dd, mm, yyyy, hh = "0", mi = "0"] = m;
  return Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi) - DUBAI_OFFSET;
}

/** Whole years between a yyyy-mm-dd birth date and a moment. */
export function ageAt(dob: string, ms: number): number {
  const b = new Date(`${dob}T00:00:00+04:00`);
  const d = new Date(ms);
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const m = d.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && d.getUTCDate() < b.getUTCDate())) age--;
  return age;
}
