import { z } from "zod";

/**
 * SEAL rule DSL (plan §3, §7, §11).
 *
 * A rule is JSON: what it applies to, a condition tree of predicates, and the
 * outcome (denial code, what the insurer needs, fix templates). The rule engine
 * evaluates deterministic predicates itself; `documents` predicates name a
 * documentation concept that the order-justification agent checks in the note
 * (the engine treats them as "unknown" until the agent answers).
 *
 * Every rule carries its source. Rules lifted from Daman's public guidelines are
 * applied to SEAL's fictional insurers and say so in `source`.
 */

/** Code patterns: exact ("83036"), prefix wildcard ("E11*"), or range ("72141-72158"). */
export const CodePattern = z.string().regex(/^[A-Z0-9.]+(\*|-[A-Z0-9.]+)?$/i, "code, prefix*, or a-b range");

/** Things a note can say that insurers look for. The deep checker maps note spans to these. */
export const DocConcept = z.enum([
  "symptom_duration",
  "conservative_treatment_failed",
  "neurologic_deficit",
  "new_or_progressive_deficit",
  "red_flag_symptom",
  "signs_or_symptoms_present",
  "qualifying_diagnosis_documented",
  "reason_for_repeat_test",
  "medication_change",
  "neuro_manifestations",
  "pain_score_baseline",
  "pain_score_improvement",
  "significant_change_in_condition",
  "previous_investigation_inconclusive",
]);
export type DocConcept = z.infer<typeof DocConcept>;

export const Specialty = z.enum([
  "orthopaedics",
  "radiology",
  "internal_medicine",
  "family_medicine",
  "general_practice",
  "emergency_medicine",
  "endocrinology",
  "cardiology",
  "rheumatology",
  "physical_medicine_rehab",
  "sports_medicine",
  "physiotherapy",
  "occupational_therapy",
  "surgery",
  "anaesthesia",
  "critical_care",
  "paediatrics",
]);

export type Predicate =
  | { op: "all"; of: Predicate[] }
  | { op: "any"; of: Predicate[] }
  | { op: "not"; of: Predicate }
  /** The claim/encounter carries a diagnosis matching any pattern. */
  | { op: "hasDiagnosis"; codes: string[]; principalOnly?: boolean }
  /** Another activity on the same claim matches. */
  | { op: "claimHasActivity"; codes: string[] }
  /** The patient had a matching activity within N days before this one (from history/ledger). */
  | { op: "priorActivityWithin"; codes: string[]; days: number; samePayer?: boolean; sameSpecialty?: boolean }
  /** Count of matching activities for this member in a rolling window (incl. this one) exceeds max. */
  | { op: "countWithin"; codes: string[]; days: number; max: number }
  /** Billed quantity of this activity exceeds a fixed max, or the prior-auth approved quantity. */
  | { op: "quantityExceeds"; max: number | "priorAuthApproved" }
  | { op: "priorAuthMissing" }
  | { op: "clinicianSpecialtyIn"; values: z.infer<typeof Specialty>[] }
  | { op: "encounterTypeIn"; values: number[] }
  | { op: "patientAge"; gte?: number; lte?: number }
  | { op: "benefitMissing"; benefit: string }
  /** The note documents the concept (checked by the deep agent, with an evidence span). */
  | { op: "documents"; concept: DocConcept }
  /** Lab performed in-house (same facility group) rather than an external lab. */
  | { op: "labPerformedInHouse" };

export const Predicate: z.ZodType<Predicate> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("all"), of: z.array(Predicate).min(1) }),
    z.object({ op: z.literal("any"), of: z.array(Predicate).min(1) }),
    z.object({ op: z.literal("not"), of: Predicate }),
    z.object({ op: z.literal("hasDiagnosis"), codes: z.array(CodePattern).min(1), principalOnly: z.boolean().optional() }),
    z.object({ op: z.literal("claimHasActivity"), codes: z.array(CodePattern).min(1) }),
    z.object({
      op: z.literal("priorActivityWithin"),
      codes: z.array(CodePattern).min(1),
      days: z.number().int().positive(),
      samePayer: z.boolean().optional(),
      sameSpecialty: z.boolean().optional(),
    }),
    z.object({ op: z.literal("countWithin"), codes: z.array(CodePattern).min(1), days: z.number().int().positive(), max: z.number().int().nonnegative() }),
    z.object({ op: z.literal("quantityExceeds"), max: z.union([z.number().positive(), z.literal("priorAuthApproved")]) }),
    z.object({ op: z.literal("priorAuthMissing") }),
    z.object({ op: z.literal("clinicianSpecialtyIn"), values: z.array(Specialty).min(1) }),
    z.object({ op: z.literal("encounterTypeIn"), values: z.array(z.number().int()).min(1) }),
    z.object({ op: z.literal("patientAge"), gte: z.number().optional(), lte: z.number().optional() }),
    z.object({ op: z.literal("benefitMissing"), benefit: z.string() }),
    z.object({ op: z.literal("documents"), concept: DocConcept }),
    z.object({ op: z.literal("labPerformedInHouse") }),
  ]),
) as z.ZodType<Predicate>;

export const RuleSource = z.object({
  /** Short citation, e.g. "Daman — Diabetes Mellitus Lab Tests Adjudication Guideline". */
  title: z.string(),
  publisher: z.string(),
  ref: z.string().optional(),
  version: z.string().optional(),
  revisionDate: z.string().optional(),
  section: z.string().optional(),
  url: z.string().url(),
  /** Short verbatim quote the rule is built from. */
  quote: z.string().max(400),
  /** Local copy of the text extract under /research, for audit. */
  extract: z.string().optional(),
});

export const Rule = z.object({
  id: z.string().regex(/^[A-Z0-9]+(-[A-Z0-9]+)+$/),
  version: z.number().int().positive(),
  title: z.string(),
  family: z.enum(["MNEC", "DUPL", "AUTH", "CODE", "PRCE", "NCOV", "ELIG", "BENX", "CLAI", "COPY", "TIME"]),
  denialCode: z.string().regex(/^[A-Z]{4}-\d{3}$/),
  /**
   * "stated": the source document itself lists this denial code for this situation.
   * "inferred": the source states the rule but not which code; SEAL chose the closest listed code.
   */
  denialCodeBasis: z.enum(["stated", "inferred"]),
  /** Which insurers apply it. "*" = all SEAL insurers (the plan applies Daman rules to fictional insurers). */
  payers: z.union([z.literal("*"), z.array(z.string()).min(1)]),
  /** The order/activity the rule is about. */
  target: z.object({
    activityType: z.union([z.literal(3), z.literal(4), z.literal(5), z.literal(8)]).default(3),
    codes: z.array(CodePattern).min(1),
    kind: z.enum(["lab", "imaging", "procedure", "therapy", "drug", "visit"]),
  }),
  /** When true the rule FIRES (the line is at risk). */
  when: Predicate,
  /** Stages where it runs: at the order, on the built claim, or both. */
  stages: z.array(z.enum(["point_of_care", "claim"])).min(1),
  severity: z.enum(["high", "medium", "low"]),
  /** What the insurer needs to see — shown on the risk card. */
  insurerNeeds: z.string(),
  /** Fix templates with ____ blanks the doctor fills. Never pre-filled by the AI. */
  fixTemplates: z.array(z.string()).default([]),
  fixActions: z.array(z.enum(["add_documentation", "link_diagnosis", "remove_order", "request_prior_auth", "adjust_quantity", "rebill_combined_code", "remove_line"])).min(1),
  source: RuleSource,
  /** true = built directly from a primary source we hold; false = secondary/undated/assumption. */
  verified: z.boolean(),
  notes: z.string().optional(),
});
export type Rule = z.infer<typeof Rule>;

export const RuleFile = z.object({
  $schema: z.literal("seal-rule-dsl/v1"),
  id: z.string(),
  description: z.string(),
  rules: z.array(Rule).min(1),
});
export type RuleFile = z.infer<typeof RuleFile>;
