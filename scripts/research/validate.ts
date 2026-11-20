/**
 * Phase 1 acceptance check: every research output is internally consistent.
 *   npx tsx scripts/research/validate.ts
 *
 * - Sample XMLs pass the R1 field rules (lib/claims/schema.ts) and round-trip through the builder.
 * - Every rule file parses against the rule DSL, ids are unique, and every rule has a source URL.
 * - Every denial code used by a rule (and by the sample remittance) exists in R2's denial_codes.json.
 * - Every diagnosis pattern in a rule matches at least one billable ICD-10-CM FY2027 code.
 * - Every exact CPT code used by a rule is in the R5 CPT subset (warning only; ranges are skipped).
 */
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { RuleFile, type Predicate, type Rule } from "../../lib/rules/dsl";
import { parseTransaction, buildClaimSubmission, buildRemittanceAdvice } from "../../lib/claims/xml";

const root = join(__dirname, "../..");
const r = (p: string) => join(root, p);
const errors: string[] = [];
const warnings: string[] = [];
const ok = (msg: string) => console.log(`  ✓ ${msg}`);

// ── R5 codes ──────────────────────────────────────────────────────────────
const icd = JSON.parse(gunzipSync(readFileSync(r("research/R5/codes/icd10cm_2027_full.json.gz"))).toString()) as { codes: { code: string }[] };
const icdCodes = icd.codes.map((c) => c.code);
const icdSet = new Set(icdCodes);
const cpt = new Set((JSON.parse(readFileSync(r("research/R5/codes/cpt_seal_subset.json"), "utf8")) as { codes: { code: string }[] }).codes.map((c) => c.code));
console.log("R5 codes");
ok(`${icdCodes.length} billable ICD-10-CM FY2027 codes, ${cpt.size} CPT subset codes`);

// ── R2 denial codes ───────────────────────────────────────────────────────
const denial = JSON.parse(readFileSync(r("research/R2/denial_codes.json"), "utf8")) as { codes: { code: string; status: string }[] };
const denialMap = new Map(denial.codes.map((c) => [c.code, c.status]));
console.log("R2 denial codes");
ok(`${denial.codes.length} codes, ${[...denialMap.values()].filter((s) => s === "VERIFIED").length} VERIFIED`);

// ── R1 samples ────────────────────────────────────────────────────────────
console.log("R1 samples");
for (const f of readdirSync(r("research/R1/samples")).filter((f) => f.endsWith(".xml"))) {
  try {
    const xml = readFileSync(r(`research/R1/samples/${f}`), "utf8");
    const tx = parseTransaction(xml);
    const rebuilt = tx.kind === "Claim.Submission" ? buildClaimSubmission(tx.data) : buildRemittanceAdvice(tx.data);
    const again = parseTransaction(rebuilt);
    if (JSON.stringify(again.data) !== JSON.stringify(tx.data)) errors.push(`${f}: build → parse round trip changed the data`);
    if (tx.kind === "Remittance.Advice")
      for (const c of tx.data.Claim)
        for (const a of c.Activity)
          if (a.DenialCode && !denialMap.has(a.DenialCode)) errors.push(`${f}: denial code ${a.DenialCode} not in R2 list`);
    ok(`${f} (${tx.kind}) valid, round-trips`);
  } catch (e) {
    errors.push(`${f}: ${(e as Error).message}`);
  }
}

// ── R3/R4 rules ───────────────────────────────────────────────────────────
function walk(p: Predicate, fn: (p: Predicate) => void) {
  fn(p);
  if (p.op === "all" || p.op === "any") p.of.forEach((c) => walk(c, fn));
  if (p.op === "not") walk(p.of, fn);
}
function icdPatternMatches(pattern: string) {
  if (pattern.endsWith("*")) {
    const pre = pattern.slice(0, -1);
    return icdCodes.some((c) => c.startsWith(pre));
  }
  return icdSet.has(pattern);
}

console.log("R3/R4 rules");
const ids = new Set<string>();
const allRules: Rule[] = [];
for (const dir of ["research/R3/rules", "research/R4/rules"]) {
  for (const f of readdirSync(r(dir)).filter((f) => f.endsWith(".json"))) {
    const parsed = RuleFile.safeParse(JSON.parse(readFileSync(r(`${dir}/${f}`), "utf8")));
    if (!parsed.success) {
      errors.push(`${dir}/${f}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      continue;
    }
    for (const rule of parsed.data.rules) {
      if (ids.has(rule.id)) errors.push(`duplicate rule id ${rule.id}`);
      ids.add(rule.id);
      allRules.push(rule);
      if (!denialMap.has(rule.denialCode)) errors.push(`${rule.id}: denial code ${rule.denialCode} not in R2 list`);
      else if (denialMap.get(rule.denialCode) !== "VERIFIED") warnings.push(`${rule.id}: uses UNVERIFIED denial code ${rule.denialCode}`);
      walk(rule.when, (p) => {
        if (p.op === "hasDiagnosis") for (const c of p.codes) if (!icdPatternMatches(c)) errors.push(`${rule.id}: diagnosis ${c} matches no billable FY2027 ICD-10-CM code`);
      });
      for (const c of rule.target.codes) if (!c.includes("-") && !c.endsWith("*") && !cpt.has(c)) warnings.push(`${rule.id}: CPT ${c} not in R5 subset`);
    }
    ok(`${dir}/${f}: ${parsed.data.rules.length} rules`);
  }
}
const verified = allRules.filter((x) => x.verified).length;
const inferred = allRules.filter((x) => x.denialCodeBasis === "inferred").length;
ok(`${allRules.length} rules total — ${verified} verified, ${allRules.length - verified} assumption; ${inferred} with an inferred denial code`);

// ── Report ────────────────────────────────────────────────────────────────
for (const w of [...new Set(warnings)]) console.log(`  ! ${w}`);
if (errors.length) {
  console.error(`\n✗ ${errors.length} error(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("\n✓ research outputs valid");
