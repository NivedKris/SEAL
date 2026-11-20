/** Small seeded RNG + helpers so every seed run is reproducible. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  chance(p: number) {
    return this.next() < p;
  }
  int(min: number, max: number) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)];
  }
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    const total = items.reduce((s, t) => s + weight(t), 0);
    let r = this.next() * total;
    for (const t of items) {
      r -= weight(t);
      if (r <= 0) return t;
    }
    return items[items.length - 1];
  }
  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  }
  /** Geometric-ish count >= min, capped at max, mean ≈ min + 1/p - 1. */
  skewed(min: number, max: number, p: number) {
    let n = min;
    while (n < max && !this.chance(p)) n++;
    return n;
  }
}

export const DAY = 86_400_000;

/** ISO string in Dubai time (+04:00). */
export function dubaiIso(ms: number): string {
  const d = new Date(ms + 4 * 3600_000);
  return d.toISOString().replace("Z", "+04:00").replace(/\.\d{3}/, "");
}

/** eClaimLink date-time "dd/mm/yyyy HH:MM" in Dubai time. */
export function eclaimDateTime(ms: number): string {
  const d = new Date(ms + 4 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export const dateMs = (yyyyMmDd: string) => Date.parse(`${yyyyMmDd}T00:00:00+04:00`);
