/** Dev check: first-pass refusal rate per CPT code in the generated seed. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

type Remit = { claimVersion: number; lines: { code: string; denialCode?: string }[] };
const seed = JSON.parse(gunzipSync(readFileSync("scripts/seed/output/seed.json.gz")).toString()) as { collections: { remittances: Remit[] } };
const stats = new Map<string, [number, number]>();
for (const r of seed.collections.remittances) {
  if (r.claimVersion !== 1) continue;
  for (const l of r.lines) {
    const s = stats.get(l.code) ?? [0, 0];
    s[0]++;
    if (l.denialCode) s[1]++;
    stats.set(l.code, s);
  }
}
const rows = [...stats.entries()].sort((a, b) => b[1][0] - a[1][0]);
for (const [code, [n, d]] of rows) console.log(code.padEnd(6), String(n).padStart(6), `${((d / n) * 100).toFixed(1)}%`.padStart(7));
