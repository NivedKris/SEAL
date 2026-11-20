import type { DocConcept, Predicate, Rule } from "./dsl";

/**
 * Deterministic rule engine over the SEAL rule DSL.
 *
 * Three-valued: a predicate is true, false or "unknown". `documents` predicates are
 * unknown until the order-justification agent (or seed ground truth) answers, so the
 * live checker can flag a *possible* risk instantly and the deep check confirms it.
 */

export type Tri = true | false | "unknown";

export type HistoryItem = { code: string; at: number; payerId: string; specialty?: string };

export type RuleContext = {
  payerId: string;
  encounterType: number;
  clinicianSpecialty: string;
  patientAge: number;
  diagnoses: { code: string; primary: boolean }[];
  /** Every line on the encounter/claim (incl. the one being checked). */
  lines: { code: string; quantity: number }[];
  /** This patient's earlier activities (strictly before `at`). */
  history: HistoryItem[];
  /** Date of the activity being checked (ms). */
  at: number;
  benefits: string[];
  /** Does this member's plan require prior approval for the code? */
  priorAuthRequired: (code: string) => boolean;
  /** Approved prior authorisation covering this line, if any. */
  priorAuthFor: (code: string) => { approvedQty: number } | null;
  labInHouse: boolean;
  /** Is the concept documented in the note? null = not yet known. */
  documents: (concept: DocConcept) => boolean | null;
};

export type RuleHit = {
  ruleId: string;
  rule: Rule;
  code: string;
  /** true = will likely be refused; "unknown" = depends on documentation not yet checked. */
  fired: Exclude<Tri, false>;
  /** Documentation concepts the rule looked for that are absent or unknown. */
  missing: DocConcept[];
};

const DAY = 86_400_000;

// ── Code patterns ─────────────────────────────────────────────────────────
const norm = (c: string) => c.toUpperCase().replace(/\./g, "");

export function codeMatches(pattern: string, code: string): boolean {
  const p = pattern.toUpperCase();
  const c = norm(code);
  if (p.endsWith("*")) return c.startsWith(norm(p.slice(0, -1)));
  const dash = p.indexOf("-");
  // A range like 72141-72158 (both sides same length). Service codes such as "17-01" have short sides and are matched literally.
  if (dash > 0) {
    const [a, b] = [norm(p.slice(0, dash)), norm(p.slice(dash + 1))];
    if (a.length === b.length && a.length >= 4) return c.length === a.length && c >= a && c <= b;
  }
  return c === norm(p);
}
export const anyMatch = (patterns: string[], code: string) => patterns.some((p) => codeMatches(p, code));

// ── Three-valued logic ────────────────────────────────────────────────────
const and = (xs: Tri[]): Tri => (xs.includes(false) ? false : xs.includes("unknown") ? "unknown" : true);
const or = (xs: Tri[]): Tri => (xs.includes(true) ? true : xs.includes("unknown") ? "unknown" : false);
const not = (x: Tri): Tri => (x === "unknown" ? "unknown" : !x);

export function evaluate(p: Predicate, ctx: RuleContext, line: { code: string; quantity: number }): Tri {
  switch (p.op) {
    case "all":
      return and(p.of.map((q) => evaluate(q, ctx, line)));
    case "any":
      return or(p.of.map((q) => evaluate(q, ctx, line)));
    case "not":
      return not(evaluate(p.of, ctx, line));
    case "hasDiagnosis":
      return ctx.diagnoses.some((d) => (!p.principalOnly || d.primary) && anyMatch(p.codes, d.code));
    case "claimHasActivity":
      return ctx.lines.some((l) => l !== line && anyMatch(p.codes, l.code));
    case "priorActivityWithin":
      return ctx.history.some(
        (h) =>
          h.at < ctx.at &&
          ctx.at - h.at <= p.days * DAY &&
          anyMatch(p.codes, h.code) &&
          (!p.samePayer || h.payerId === ctx.payerId) &&
          (!p.sameSpecialty || h.specialty === ctx.clinicianSpecialty),
      );
    case "countWithin": {
      const n = ctx.history.filter((h) => h.at < ctx.at && ctx.at - h.at <= p.days * DAY && anyMatch(p.codes, h.code)).length;
      return n + 1 > p.max;
    }
    case "quantityExceeds": {
      if (p.max === "priorAuthApproved") {
        const pa = ctx.priorAuthFor(line.code);
        return pa ? line.quantity > pa.approvedQty : false;
      }
      return line.quantity > p.max;
    }
    case "priorAuthMissing":
      return ctx.priorAuthRequired(line.code) && !ctx.priorAuthFor(line.code);
    case "clinicianSpecialtyIn":
      return (p.values as string[]).includes(ctx.clinicianSpecialty);
    case "encounterTypeIn":
      return p.values.includes(ctx.encounterType);
    case "patientAge":
      return (p.gte === undefined || ctx.patientAge >= p.gte) && (p.lte === undefined || ctx.patientAge <= p.lte);
    case "benefitMissing":
      return !ctx.benefits.includes(p.benefit);
    case "documents": {
      const v = ctx.documents(p.concept);
      return v === null ? "unknown" : v;
    }
    case "labPerformedInHouse":
      return ctx.labInHouse;
  }
}

function conceptsIn(p: Predicate, out = new Set<DocConcept>()): Set<DocConcept> {
  if (p.op === "documents") out.add(p.concept);
  if (p.op === "all" || p.op === "any") p.of.forEach((q) => conceptsIn(q, out));
  if (p.op === "not") conceptsIn(p.of, out);
  return out;
}

export function ruleApplies(rule: Rule, payerId: string, code: string) {
  return (rule.payers === "*" || rule.payers.includes(payerId)) && anyMatch(rule.target.codes, code);
}

/** Run every applicable rule against one line. Returns the rules that fire (or might). */
export function checkLine(rules: Rule[], ctx: RuleContext, line: { code: string; quantity: number }, stage?: "point_of_care" | "claim"): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const rule of rules) {
    if (stage && !rule.stages.includes(stage)) continue;
    if (!ruleApplies(rule, ctx.payerId, line.code)) continue;
    const r = evaluate(rule.when, ctx, line);
    if (r === false) continue;
    const missing = [...conceptsIn(rule.when)].filter((c) => ctx.documents(c) !== true);
    hits.push({ ruleId: rule.id, rule, code: line.code, fired: r, missing });
  }
  return hits;
}

/** Run all rules over every line of an encounter or claim. */
export function checkAll(rules: Rule[], ctx: RuleContext, stage?: "point_of_care" | "claim"): RuleHit[] {
  return ctx.lines.flatMap((l) => checkLine(rules, ctx, l, stage));
}
