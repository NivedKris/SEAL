/** Dev check: refused value (first pass) by denial family and by line kind. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { kindOf } from "../seed/sim";

type Remit = { claimVersion: number; lines: { code: string; net: number; paymentAmount: number; denialCode?: string }[] };
const seed = JSON.parse(gunzipSync(readFileSync("scripts/seed/output/seed.json.gz")).toString()) as { collections: { remittances: Remit[] } };
const fam = new Map<string, number>();
const kind = new Map<string, number>();
let total = 0;
for (const r of seed.collections.remittances) {
  if (r.claimVersion !== 1) continue;
  for (const l of r.lines) {
    if (!l.denialCode) continue;
    const v = l.net - l.paymentAmount;
    total += v;
    const f = l.denialCode.split("-")[0];
    fam.set(f, (fam.get(f) ?? 0) + v);
    const k = `${f}/${kindOf(l.code)}`;
    kind.set(k, (kind.get(k) ?? 0) + v);
  }
}
console.log("total refused AED", Math.round(total));
for (const [k, v] of [...fam.entries()].sort((a, b) => b[1] - a[1])) console.log(k.padEnd(6), Math.round(v).toString().padStart(8), `${((v / total) * 100).toFixed(1)}%`);
console.log("--");
for (const [k, v] of [...kind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(k.padEnd(18), Math.round(v).toString().padStart(8), `${((v / total) * 100).toFixed(1)}%`);
console.log("-- by denial code + CPT");
const pair = new Map<string, [number, number]>();
for (const r of seed.collections.remittances) {
  if (r.claimVersion !== 1) continue;
  for (const l of r.lines) {
    if (!l.denialCode) continue;
    const k = `${l.denialCode} ${l.code}`;
    const p = pair.get(k) ?? [0, 0];
    p[0]++;
    p[1] += l.net - l.paymentAmount;
    pair.set(k, p);
  }
}
for (const [k, [n, v]] of [...pair.entries()].sort((a, b) => b[1][1] - a[1][1]).slice(0, 15)) console.log(k.padEnd(16), String(n).padStart(5), Math.round(v).toString().padStart(8));
