/**
 * Phase 3 check (read-only):
 *  1. eClaimLink XML rebuilt for a sample of seeded claims (every version) passes the R1 field rules.
 *  2. The live mock insurer, re-adjudicating those first submissions, refuses at about the seeded rate.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/dev/phase3-parity.ts [n]
 */
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C, type ClaimDoc, type RemittanceDoc } from "@/lib/db/schemas";
import { claimVersionXml } from "@/lib/claims/submit";
import { parseTransaction } from "@/lib/claims/xml";
import { adjudicateClaim, loadFacts } from "@/lib/mock/insurer";

async function main() {
  const n = Number(process.argv[2] ?? 600);
  const d = await db();
  const claims = (await d.collection(C.claims).aggregate([{ $match: { evalSet: false, scenario: { $exists: false } } }, { $sample: { size: n } }]).toArray()) as unknown as ClaimDoc[];

  let files = 0;
  let seededRefused = 0;
  let liveRefused = 0;
  let lines = 0;
  let lineAgree = 0;
  let both = 0;
  const byPayer: Record<string, { n: number; seeded: number; live: number }> = {};
  const liveCodes: Record<string, number> = {};
  const seededCodes: Record<string, number> = {};
  const t0 = Date.now();

  const work = async (claim: ClaimDoc) => {
    for (const v of claim.versions) {
      parseTransaction(await claimVersionXml(claim, v.version, d)); // throws on any R1 violation
      files++;
    }
    const tx = parseTransaction(await claimVersionXml(claim, 1, d));
    if (tx.kind !== "Claim.Submission") throw new Error("expected a claim");
    const c = tx.data.Claim[0];
    const ra1 = (await d.collection(C.remittances).findOne({ claimId: claim._id, claimVersion: 1 })) as RemittanceDoc | null;
    if (!ra1) return;
    const facts = await loadFacts(c, d, new Date(claim.versions[0].sentAt!).getTime(), { asFirstSubmission: true });
    const live = adjudicateClaim(c, facts);
    const seeded = new Map(ra1.lines.map((l) => [l.activityId, l.denialCode]));
    const s = ra1.lines.some((l) => l.denialCode);
    const l = live.some((x) => x.denialCode);
    const p = (byPayer[claim.payerId] ??= { n: 0, seeded: 0, live: 0 });
    p.n++;
    if (s) {
      seededRefused++;
      p.seeded++;
    }
    if (l) {
      liveRefused++;
      p.live++;
    }
    if (s && l) both++;
    for (const x of live) {
      lines++;
      if ((seeded.get(x.activityId) ?? null) === (x.denialCode ?? null)) lineAgree++;
      if (x.denialCode) liveCodes[x.denialCode] = (liveCodes[x.denialCode] ?? 0) + 1;
      const sc = seeded.get(x.activityId);
      if (sc) seededCodes[sc] = (seededCodes[sc] ?? 0) + 1;
    }
  };
  for (let i = 0; i < claims.length; i += 12) await Promise.all(claims.slice(i, i + 12).map(work));

  const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
  console.log(`XML: ${files} claim files from ${claims.length} seeded claims rebuilt and valid against the R1 field rules`);
  console.log(`first-pass refusal — seeded ${pct(seededRefused, claims.length)}, live insurer ${pct(liveRefused, claims.length)}; refused by both ${both}`);
  for (const [k, v] of Object.entries(byPayer)) console.log(`  ${k.padEnd(10)} n=${v.n} seeded ${pct(v.seeded, v.n)} live ${pct(v.live, v.n)}`);
  console.log(`line decisions identical: ${pct(lineAgree, lines)} of ${lines}`);
  const top = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(`seeded codes: ${top(seededCodes)}\nlive codes:   ${top(liveCodes)}`);
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
