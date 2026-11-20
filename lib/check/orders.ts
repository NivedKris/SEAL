import "server-only";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import { COLLECTIONS as C, type ClaimDoc, type ProviderDoc } from "@/lib/db/schemas";
import { DocConcept, type Rule } from "@/lib/rules/dsl";
import { anyMatch, checkLine, ruleApplies, type HistoryItem, type RuleContext, type RuleHit } from "@/lib/rules/engine";
import { activeRules } from "@/lib/rules/active";
import { codedQualifier } from "@/lib/rules/qualifier";
import { CONCEPT_TEXT } from "@/lib/rules/concepts";
import { loadEncounterBundle, type EncounterBundle } from "@/lib/claims/bundle";
import { AgentDisabled, loadPrompt, runAgent, annotateCall } from "@/lib/ai/agent";
import { cptLabel, icdLabel } from "@/lib/codes";
import { ageAt } from "@/lib/util/time";
import { norm, quoted } from "./quotes";

/**
 * Point-of-care order check (plan §5 stage 1). "live": rule engine at once, then the fast model
 * confirms documentation. "deep": the reasoning model on a typing pause and on Sign. Both read the
 * note as the doctor sees it right now and never write clinical text; fixes are offered, not applied.
 */

export type OrderMode = "rules" | "live" | "deep";
const ER_TYPES = new Set([2, 4, 6]);

export const Answers = z.object({
  answers: z.array(z.object({ ruleId: z.string(), orderId: z.string(), concept: DocConcept, documented: z.boolean(), evidence: z.string() })),
});
type Answer = z.infer<typeof Answers>["answers"][number];

export type OrderCard = {
  ruleId: string;
  title: string;
  denialCode: string;
  severity: string;
  kind: "documentation" | "fix" | "link_diagnosis";
  /** "risk" = confirmed; "possible" = depends on documentation not checked yet. */
  certainty: "risk" | "possible";
  insurerNeeds: string;
  missing: { concept: DocConcept; text: string }[];
  evidence: string[];
  fixTemplates: string[];
  fixActions: string[];
  /** For link_diagnosis: ICD patterns that would qualify (the doctor or coder picks the code). */
  qualifyingCodes?: string[];
  source: { publisher: string; title: string; url: string; verified: boolean };
};
export type OrderResult = { orderId: string; code: string; label: string; kind: string; status: "justified" | "at_risk" | "checking"; cards: OrderCard[]; checkedConcepts: { concept: DocConcept; documented: boolean; evidence: string }[] };
export type OrderCheck = { encounterId: string; mode: OrderMode; ms: number; orders: OrderResult[]; model?: string; provider?: string; aiCallId?: string; aiError?: string; flags: string[] };

type NoteOverride = { complaint?: string; findings?: string; plan?: string };

/** Answers per (note, questions): typing the same text twice never calls a model twice. */
const cache = new Map<string, { at: number; answers: Answer[]; mode: OrderMode }>();

async function history(b: EncounterBundle, d: Db): Promise<HistoryItem[]> {
  const at = new Date(b.encounter.start).getTime();
  const past = (await d.collection(C.claims).find({ patientId: b.patient._id }, { projection: { versions: { $slice: 1 }, payerId: 1, providerId: 1, encounterId: 1 } }).toArray()) as unknown as Pick<ClaimDoc, "versions" | "payerId" | "providerId" | "encounterId">[];
  const provs = (await d.collection(C.providers).find({ _id: { $in: [...new Set(past.map((p) => p.providerId))] as never[] } }).toArray()) as unknown as ProviderDoc[];
  const out: HistoryItem[] = [];
  for (const p of past) {
    if (p.encounterId === b.encounter._id) continue;
    for (const l of p.versions[0].lines) {
      const t = new Date(l.start).getTime();
      if (t < at) out.push({ code: l.code, at: t, payerId: p.payerId, specialty: provs.find((x) => x._id === p.providerId)?.specialty });
    }
  }
  return out;
}

const ruleSource = (r: Rule) => ({ publisher: r.source.publisher, title: r.source.title, url: r.source.url, verified: r.verified });
const isDocRule = (r: Rule) => JSON.stringify(r.when).includes('"documents"');

export async function checkOrders(encounterId: string, d: Db, mode: OrderMode, override: NoteOverride = {}): Promise<OrderCheck> {
  const t0 = Date.now();
  const [b, rules] = await Promise.all([loadEncounterBundle(encounterId, d), activeRules(d)]);
  const hist = await history(b, d);
  const e = b.encounter;
  const note = { complaint: override.complaint ?? e.complaint, findings: override.findings ?? e.findings, plan: override.plan ?? e.plan ?? "" };
  const noteText = [`Complaint (as told): ${note.complaint}`, `Findings: ${note.findings}`, note.plan ? `Plan: ${note.plan}` : ""].filter(Boolean).join("\n");
  const at = new Date(e.start).getTime();
  const isEr = ER_TYPES.has(e.type);
  const orders = b.orders;
  const lines = orders.map((o) => ({ code: o.code, quantity: o.quantity }));
  const dx = b.diagnoses.map((x) => ({ code: x.icd10, primary: x.primary }));
  const ctxFor = (documents: (c: DocConcept) => boolean | null): RuleContext => ({
    payerId: b.payer._id,
    encounterType: e.type,
    clinicianSpecialty: b.provider.specialty,
    patientAge: ageAt(b.patient.dob, at),
    diagnoses: dx,
    lines,
    history: hist,
    at,
    benefits: b.plan.benefits,
    priorAuthRequired: (code) => !isEr && anyMatch(b.plan.priorAuthRequired, code),
    priorAuthFor: (code) => {
      const pa = b.priorAuths.find((a) => a.status === "approved" && a.codes.some((c) => anyMatch([c], code)) && Date.parse(`${a.validTo}T23:59:59+04:00`) >= at);
      return pa ? { approvedQty: pa.approvedQty } : null;
    },
    labInHouse: true,
    documents,
  });

  // 1. Rules with documentation unknown.
  const pass1 = orders.map((o) => ({ o, hits: checkLine(rules, ctxFor(() => null), { code: o.code, quantity: o.quantity }, "point_of_care") }));
  const questions = pass1.flatMap(({ o, hits }) =>
    hits.flatMap((h) => h.missing.map((c) => ({ orderId: o._id, order: `${o.code} ${o.label}`, ruleId: h.ruleId, rule: h.rule.title, insurerNeeds: h.rule.insurerNeeds, concept: c, meaning: CONCEPT_TEXT[c] }))),
  );
  // Qualifier rules that don't fire still need the "documented but not coded" check.
  for (const o of orders)
    for (const r of rules)
      if (r.stages.includes("point_of_care") && ruleApplies(r, b.payer._id, o.code) && codedQualifier(r) && !questions.some((q) => q.orderId === o._id && q.ruleId === r.id))
        questions.push({ orderId: o._id, order: `${o.code} ${o.label}`, ruleId: r.id, rule: r.title, insurerNeeds: r.insurerNeeds, concept: "qualifying_diagnosis_documented", meaning: CONCEPT_TEXT.qualifying_diagnosis_documented });

  // 2. Documentation answers from the model (cached by note + questions).
  let answers: Answer[] = [];
  let model: string | undefined, provider: string | undefined, aiCallId: string | undefined, aiError: string | undefined;
  const flags = new Set<string>();
  if (mode !== "rules" && questions.length) {
    const key = createHash("sha1").update(JSON.stringify(["v2", noteText, dx, questions.map((q) => [q.orderId, q.ruleId, q.concept])])).digest("hex");
    const hit = cache.get(key);
    if (hit && (hit.mode === "deep" || mode === "live") && Date.now() - hit.at < 10 * 60_000) answers = hit.answers;
    else {
      const agent = mode === "deep" ? "orderJustification" : "orderCheckerLive";
      try {
        const r = await runAgent(d, {
          agent,
          promptVersion: `order-justification/v1`,
          system: loadPrompt("order-justification", "v1"),
          user: JSON.stringify({ note: noteText, diagnoses: b.diagnoses.map((x) => `${x.icd10} ${x.description ?? icdLabel(x.icd10)}`), questions }),
          schema: Answers,
          subject: { encounterId },
        });
        const n = norm(noteText);
        answers = r.data.answers
          .filter((a) => questions.some((q) => q.orderId === a.orderId && q.ruleId === a.ruleId && q.concept === a.concept))
          .map((a) => {
            if (a.documented && !quoted(a.evidence, n)) {
              flags.add("evidence_not_in_note");
              return { ...a, documented: false, evidence: "" };
            }
            return a;
          });
        if (flags.size) await annotateCall(d, r.call._id, { guardrailFlags: [...flags] });
        cache.set(key, { at: Date.now(), answers, mode });
        ({ model, provider } = r.call);
        aiCallId = r.call._id;
      } catch (err) {
        aiError = err instanceof AgentDisabled ? err.message : `order check unavailable: ${(err as Error).message.slice(0, 160)}`;
      }
    }
  }
  const answered = (orderId: string, c: DocConcept) => answers.filter((a) => a.orderId === orderId && a.concept === c);
  const docFor = (orderId: string) => (c: DocConcept) => {
    const xs = answered(orderId, c);
    return xs.length ? xs.some((a) => a.documented) : null;
  };

  // 3. Rules again with the answers → cards.
  const results: OrderResult[] = orders.map((o) => {
    const hits: RuleHit[] = checkLine(rules, ctxFor(docFor(o._id)), { code: o.code, quantity: o.quantity }, "point_of_care");
    const cards: OrderCard[] = hits.map((h) => {
      const doc = isDocRule(h.rule);
      const missing = h.missing.filter((c) => docFor(o._id)(c) !== true);
      return {
        ruleId: h.ruleId,
        title: h.rule.title,
        denialCode: h.rule.denialCode,
        severity: h.rule.severity,
        kind: doc ? "documentation" : "fix",
        certainty: h.fired === true ? "risk" : "possible",
        insurerNeeds: h.rule.insurerNeeds,
        missing: missing.map((c) => ({ concept: c, text: CONCEPT_TEXT[c] })),
        evidence: h.missing.flatMap((c) => answered(o._id, c).filter((a) => a.documented).map((a) => a.evidence)),
        fixTemplates: h.rule.fixTemplates,
        fixActions: h.rule.fixActions,
        qualifyingCodes: codedQualifier(h.rule) ?? undefined,
        source: ruleSource(h.rule),
      };
    });
    // Documented but not coded (e.g. osteopenia in the note, no M85.8x on the encounter).
    for (const r of rules) {
      const codes = codedQualifier(r);
      if (!codes || !r.stages.includes("point_of_care") || !ruleApplies(r, b.payer._id, o.code) || hits.some((h) => h.ruleId === r.id)) continue;
      const ev = answered(o._id, "qualifying_diagnosis_documented").filter((a) => a.ruleId === r.id && a.documented);
      if (!ev.length || dx.some((x) => anyMatch(codes, x.code))) continue;
      cards.push({ ruleId: r.id, title: "Qualifying condition is in the note but not on the diagnosis list", denialCode: r.denialCode, severity: r.severity, kind: "link_diagnosis", certainty: "risk", insurerNeeds: r.insurerNeeds, missing: [], evidence: ev.map((a) => a.evidence), fixTemplates: [], fixActions: ["link_diagnosis", "remove_order"], qualifyingCodes: codes, source: ruleSource(r) });
    }
    const pending = cards.some((c) => c.certainty === "possible") && mode !== "rules" && !aiError;
    return {
      orderId: o._id,
      code: o.code,
      label: o.label || cptLabel(o.code),
      kind: o.kind,
      status: cards.length === 0 ? "justified" : pending && !answers.length ? "checking" : "at_risk",
      cards,
      checkedConcepts: answers.filter((a) => a.orderId === o._id).map((a) => ({ concept: a.concept, documented: a.documented, evidence: a.evidence })),
    };
  });
  return { encounterId, mode, ms: Date.now() - t0, orders: results, model, provider, aiCallId, aiError, flags: [...flags] };
}
