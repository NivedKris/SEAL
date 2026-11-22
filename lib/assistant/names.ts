/**
 * Matching names the way people say them, and the way speech recognition writes them down:
 * "Omar Hadad" → Dr. Omar Haddad, "Priya Ayer" → Priya Iyer, "Sukoon" → Sukoon Insurance.
 * Titles and punctuation are ignored, doubled letters count once, and each word may be a little
 * off (one or two letters) or only the start of the word.
 */
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9؀-ۿ\s]/g, " ")
    .replace(/\b(dr|doctor|mr|mrs|ms|miss|prof|pt)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const squash = (w: string) => w.replace(/(.)\1+/g, "$1");

function lev(a: string, b: string) {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

const wordSim = (q: string, n: string) => {
  const a = squash(q);
  const b = squash(n);
  if (a === b) return 1;
  if (a.length >= 3 && b.startsWith(a)) return 0.93;
  return 1 - lev(a, b) / Math.max(a.length, b.length);
};

/** How well a spoken name fits a known one (0..1): every spoken word must fit some word of the name. */
export function nameScore(said: string, known: string) {
  const q = norm(said).split(" ").filter(Boolean);
  const n = norm(known).split(" ").filter(Boolean);
  if (!q.length || !n.length) return 0;
  const per = q.map((w) => Math.max(...n.map((x) => wordSim(w, x))));
  return per.reduce((s, x) => s + x, 0) / per.length;
}

/** The known names that fit what was said, best first (score ≥ min). */
export function bestMatches<T>(said: string, items: T[], name: (t: T) => string, min = 0.74) {
  return items
    .map((item) => ({ item, score: nameScore(said, name(item)) }))
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score);
}

/** One word of the name each (3+ letters), for a broad database search before ranking. */
export const nameWords = (said: string) => norm(said).split(" ").filter((w) => w.length >= 3);
