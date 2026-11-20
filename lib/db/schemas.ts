import { z } from "zod";
import { DocConcept, Specialty } from "@/lib/rules/dsl";

/**
 * Document schemas for every MongoDB collection (plan §8). Shared by the API, the UI
 * and the seed pipeline. `_id`s are strings so they are stable across seed runs.
 * Every document SEAL writes records who/what wrote it and when (`writtenBy`, `writtenAt`).
 */

const Id = z.string().min(1);
const IsoDate = z.string().datetime({ offset: true });
export const Actor = z.object({
  kind: z.enum(["seed", "user", "agent", "system", "mock_insurer", "mock_dhpo", "emr"]),
  id: z.string(),
});
const Provenance = { writtenBy: Actor, writtenAt: IsoDate };

// ── Clinical source data (owned by the EMR simulator) ─────────────────────
export const Patient = z.object({
  _id: Id,
  maskedId: z.string(),
  name: z.string(),
  nameAr: z.string().optional(),
  dob: z.string(), // yyyy-mm-dd
  sex: z.enum(["M", "F"]),
  nationality: z.string(),
  emiratesIdMasked: z.string(),
  /** Full synthetic Emirates ID — never sent to a model (masking layer, plan §7). */
  emiratesId: z.string(),
  ...Provenance,
});

export const Member = z.object({
  _id: Id,
  patientId: Id,
  payerId: Id,
  planId: Id,
  memberNo: z.string(),
  validFrom: z.string(),
  validTo: z.string(),
  ...Provenance,
});

export const Payer = z.object({
  _id: Id,
  name: z.string(),
  nameAr: z.string(),
  eclaimLinkId: z.string(),
  fictional: z.literal(true),
  ...Provenance,
});

export const Plan = z.object({
  _id: Id,
  payerId: Id,
  name: z.string(),
  benefits: z.array(z.string()),
  /** CPT patterns that need prior approval on this plan (assumption — see seed config). */
  priorAuthRequired: z.array(z.string()),
  copayPct: z.number().min(0).max(1),
  ...Provenance,
});

export const Contract = z.object({
  _id: Id,
  payerId: Id,
  /** Multiplier on SEAL's base price list (assumption). */
  priceFactor: z.number().positive(),
  prices: z.record(z.string(), z.number().nonnegative()),
  filingDeadlineDays: z.number().int().positive(),
  ...Provenance,
});

export const Provider = z.object({
  _id: Id,
  name: z.string(),
  nameAr: z.string().optional(),
  specialty: Specialty,
  licenseNo: z.string(),
  role: z.enum(["consultant", "specialist", "general_practitioner", "therapist"]),
  ...Provenance,
});

export const NoteVersion = z.object({
  version: z.number().int().positive(),
  complaint: z.string(),
  findings: z.string(),
  plan: z.string().optional(),
  editedBy: Actor,
  editedAt: IsoDate,
});

export const Encounter = z.object({
  _id: Id,
  patientId: Id,
  memberId: Id.optional(),
  providerId: Id,
  facilityId: z.string(),
  /** eClaimLink EncounterType (1 outpatient, 2 ER, …). */
  type: z.number().int(),
  start: IsoDate,
  end: IsoDate.optional(),
  status: z.enum(["open", "signed", "claimed"]),
  /** Complaint as told by the patient, and examination findings — current text. */
  complaint: z.string(),
  findings: z.string(),
  plan: z.string().optional(),
  noteVersions: z.array(NoteVersion),
  /** Signed addenda: the doctor's own answers to SEAL's questions (SEAL's only clinical write-back, plan §6). */
  addenda: z.array(z.object({ id: z.string(), text: z.string(), signedBy: z.string(), signedAt: IsoDate, questionSetId: z.string() })).optional(),
  /** Hold flag SEAL may set on the EMR record while a claim waits for the doctor. */
  sealHold: z.boolean().optional(),
  /** E/M visit code chosen by the doctor/coder; the claim builder applies a coder default when absent. */
  visitCode: z.string().optional(),
  templateId: z.string().optional(),
  theme: z.string().optional(),
  /** Encounters in the held-out evaluation set are excluded from history and memory. */
  evalSet: z.boolean().default(false),
  scenario: z.string().optional(),
  ...Provenance,
});

/**
 * Seed answer key, one per seeded encounter: which note spans establish which documentation
 * concepts, which gaps were injected, and why the mock insurer refused. NEVER read by SEAL's
 * agents or rule engine — only by evaluation runs and the data report.
 */
export const GroundTruth = z.object({
  _id: Id, // encounter id
  claimId: z.string().optional(),
  segments: z.array(z.object({ id: z.string(), part: z.enum(["complaint", "findings"]), start: z.number(), end: z.number(), concepts: z.array(DocConcept) })),
  gaps: z.array(z.object({ ruleId: z.string(), code: z.string(), concepts: z.array(DocConcept) })),
  injected: z.array(z.string()),
  insurerReasons: z.array(z.object({ activityId: z.string(), code: z.string(), denialCode: z.string(), source: z.string().optional() })).optional(),
  expect: z.string().optional(),
});

export const Order = z.object({
  _id: Id,
  encounterId: Id,
  kind: z.enum(["lab", "imaging", "procedure", "therapy", "drug", "visit"]),
  activityType: z.number().int(),
  code: z.string(),
  label: z.string(),
  quantity: z.number().positive(),
  linkedDiagnoses: z.array(z.string()),
  justificationStatus: z.enum(["unchecked", "justified", "at_risk", "resolved", "removed"]),
  orderedAt: IsoDate,
  ...Provenance,
});

export const Diagnosis = z.object({
  _id: Id,
  encounterId: Id,
  icd10: z.string(),
  /** Present on live/scenario diagnoses; seeded history looks it up from the ICD list. */
  description: z.string().optional(),
  primary: z.boolean(),
  /** Codes come from the doctor and coder, never from the AI (plan §5 stage 2). */
  source: z.enum(["doctor", "coder"]),
  ...Provenance,
});

export const PriorAuth = z.object({
  _id: Id,
  memberId: Id,
  encounterId: Id.optional(),
  codes: z.array(z.string()),
  approvedQty: z.number().nonnegative(),
  requestedAt: IsoDate,
  validTo: z.string(),
  status: z.enum(["approved", "denied", "pending"]),
  authNo: z.string(),
  ...Provenance,
});

// ── Claims ────────────────────────────────────────────────────────────────
export const ClaimLine = z.object({
  activityId: z.string(),
  orderId: Id.optional(),
  activityType: z.number().int(),
  code: z.string(),
  quantity: z.number(),
  net: z.number(),
  clinician: z.string(),
  priorAuthId: z.string().optional(),
  start: IsoDate,
});

export const ClaimVersion = z.object({
  version: z.number().int().positive(),
  resubmissionType: z.enum(["correction", "internal complaint"]).optional(),
  comment: z.string().optional(),
  lines: z.array(ClaimLine),
  /** Diagnoses as filed in this version (live claims). Seeded history reads the diagnoses collection. */
  diagnoses: z.array(z.object({ code: z.string(), type: z.enum(["Principal", "Secondary"]) })).optional(),
  /** Addendum text attached to specific activities as eClaimLink Observations (Type "Text"). */
  observations: z.array(z.object({ activityId: z.string(), code: z.string(), text: z.string() })).optional(),
  /** Plain text sent as the eClaimLink Resubmission attachment (the hospital's PDF in real life). */
  attachmentText: z.string().optional(),
  /** Stored for live claims; generated on demand for seeded history to save space. */
  xml: z.string().optional(),
  sentAt: IsoDate.optional(),
  /** Mock DHPO transaction id of the uploaded file. */
  transactionId: z.string().optional(),
});

export const ClaimStatus = z.enum(["draft", "checking", "hold", "ready", "submitted", "paid", "partially_paid", "refused", "resubmitted", "closed"]);

export const Claim = z.object({
  _id: Id,
  claimNo: z.string(),
  encounterId: Id,
  patientId: Id,
  memberId: Id,
  payerId: Id,
  providerId: Id,
  gross: z.number(),
  patientShare: z.number(),
  net: z.number(),
  status: ClaimStatus,
  versions: z.array(ClaimVersion).min(1),
  riskScore: z.number().min(0).max(1).nullable(),
  liveCheckState: z.enum(["idle", "rules", "judge", "critic", "done", "error"]).default("idle"),
  /** Summary of the latest real-time check (plan §5 stage 3). */
  check: z
    .object({
      run: z.number().int(),
      startedAt: IsoDate,
      finishedAt: IsoDate.optional(),
      mode: z.enum(["full", "rules_only", "trained_model"]),
      /** Shadow judge's claim risk (scored alongside, never used for routing). */
      shadowRiskScore: z.number().optional(),
      route: z.enum(["ready", "hold"]).optional(),
      holdReasons: z.array(z.string()).default([]),
      lineRisk: z.record(z.string(), z.number()).default({}),
      agreement: z.enum(["agree", "low_agreement", "not_checked"]).optional(),
      aiCallIds: z.array(z.string()).default([]),
      ruleSetVersion: z.string().optional(),
      error: z.string().optional(),
    })
    .optional(),
  createdAt: IsoDate,
  evalSet: z.boolean().default(false),
  scenario: z.string().optional(),
  ...Provenance,
});

export const Finding = z.object({
  _id: Id,
  claimId: Id.optional(),
  encounterId: Id,
  orderId: Id.optional(),
  activityId: z.string().optional(),
  stage: z.enum(["point_of_care_live", "point_of_care_deep", "rule_engine", "claim_judge", "critic"]),
  ruleId: z.string().optional(),
  pastClaimIds: z.array(z.string()).default([]),
  denialCode: z.string().optional(),
  evidenceSpan: z.string().optional(),
  insurerNeeds: z.string().optional(),
  severity: z.enum(["high", "medium", "low"]),
  probability: z.number().min(0).max(1).optional(),
  status: z.enum(["open", "resolved", "dismissed", "overridden"]),
  aiCallId: z.string().optional(),
  /** Which check run produced it; earlier runs' findings are dismissed when a claim is re-checked. */
  checkRun: z.number().int().optional(),
  /** Documentation gap: concepts the insurer needs that the note does not show (feeds the question composer). */
  gapConcepts: z.array(DocConcept).optional(),
  /** "fix" = a biller/coder action (prior approval, quantity, duplicate); "documentation" = needs the doctor. */
  kind: z.enum(["fix", "documentation", "risk", "agreement"]).optional(),
  reason: z.string().optional(),
  ...Provenance,
});

export const QuestionField = z.object({
  key: z.string(),
  kind: z.enum(["number", "choice", "text", "date"]),
  labelEn: z.string(),
  labelAr: z.string(),
  options: z.array(z.string()).optional(),
  unit: z.string().optional(),
});

export const Question = z.object({
  gapId: z.string(),
  orderId: Id.optional(),
  /** The order the question is about, e.g. "72148 MRI lumbar spine without contrast". */
  order: z.string().optional(),
  findingIds: z.array(Id),
  textEn: z.string(),
  textAr: z.string(),
  insurerNeeds: z.string(),
  fields: z.array(QuestionField).min(1),
  answer: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  answeredAt: IsoDate.optional(),
});

export const QuestionSet = z.object({
  _id: Id,
  claimId: Id,
  providerId: Id,
  questions: z.array(Question),
  status: z.enum(["open", "answered", "overridden", "cancelled"]),
  addendumId: z.string().optional(),
  encounterId: Id.optional(),
  checkRun: z.number().int().optional(),
  /** Who wrote the wording: the composer model, or SEAL's built-in templates when it was unavailable. */
  composedBy: z.enum(["agent", "template"]).optional(),
  aiCallId: z.string().optional(),
  /** Answer integrator: did each answer establish what the insurer needs? */
  resolution: z.array(z.object({ gapId: z.string(), resolved: z.boolean(), note: z.string() })).optional(),
  ...Provenance,
});

// ── Rules ─────────────────────────────────────────────────────────────────
export const RuleDoc = z.object({
  _id: Id, // rule id
  payerId: z.string(), // "*" or payer id
  scope: z.enum(["seal", "mock_insurer_hidden"]),
  dsl: z.unknown(), // validated with lib/rules/dsl Rule
  sourceUrl: z.string().url(),
  verified: z.boolean(),
  version: z.number().int().positive(),
  author: z.string(),
  approvedBy: z.string().nullable(),
  active: z.boolean(),
  ...Provenance,
});

export const RuleProposal = z.object({
  _id: Id,
  clusterId: z.string(),
  dsl: z.unknown(),
  supportCount: z.number().int(),
  exampleClaimIds: z.array(Id),
  status: z.enum(["proposed", "approved", "rejected"]),
  /** Cluster facts and the back-test of the proposed rule on the window. */
  payerId: z.string().optional(),
  codes: z.array(z.string()).optional(),
  denialCode: z.string().optional(),
  windowDays: z.number().int().optional(),
  backtest: z.object({ caught: z.number(), refusedInCluster: z.number(), firedOnPaid: z.number(), paidChecked: z.number() }).optional(),
  rationale: z.string().optional(),
  aiCallId: z.string().optional(),
  decidedBy: z.string().optional(),
  decisionReason: z.string().optional(),
  ...Provenance,
});

// ── Remittances and recovery ──────────────────────────────────────────────
export const Remittance = z.object({
  _id: Id,
  claimId: Id,
  claimVersion: z.number().int(),
  payerId: Id,
  idPayer: z.string(),
  paymentReference: z.string(),
  readyAt: IsoDate,
  receivedAt: IsoDate.nullable(),
  lines: z.array(
    z.object({
      activityId: z.string(),
      code: z.string(),
      net: z.number(),
      paymentAmount: z.number(),
      denialCode: z.string().optional(),
      payerComment: z.string().optional(),
    }),
  ),
  /** Stored for live remittances; generated on demand for seeded history. */
  xml: z.string().optional(),
  ...Provenance,
});

export const Denial = z.object({
  _id: Id,
  remittanceId: Id,
  claimId: Id,
  activityId: z.string(),
  code: z.string(),
  denialCode: z.string(),
  family: z.string(),
  amount: z.number(),
  payerComment: z.string().optional(),
  deadline: IsoDate,
  status: z.enum(["queued", "drafted", "resubmitted", "won", "lost", "written_off"]),
  /** Denial reader (fast model): family, likely root cause, recoverable or not. */
  reader: z
    .object({ rootCause: z.string(), recoverable: z.boolean(), action: z.enum(["correction", "appeal", "write_off"]), confidence: z.enum(["high", "medium", "low"]), aiCallId: z.string().optional() })
    .optional(),
  draftId: z.string().optional(),
  ...Provenance,
});

export const RecoveryDraft = z.object({
  _id: Id,
  denialId: Id,
  type: z.enum(["correction", "appeal"]),
  diff: z.unknown().optional(),
  letter: z.string().optional(),
  evidence: z.array(z.object({ kind: z.string(), ref: z.string(), quote: z.string().optional() })),
  approvedBy: z.string().nullable(),
  sentAt: IsoDate.nullable(),
  claimId: Id.optional(),
  rationale: z.string().optional(),
  /** What a coder should look at (the drafter never picks or changes codes). */
  coderReview: z.string().optional(),
  aiCallId: z.string().optional(),
  flags: z.array(z.string()).default([]),
  ...Provenance,
});

// ── AI and learning ───────────────────────────────────────────────────────
export const Outcome = z.object({
  _id: Id, // = claimId
  claimId: Id,
  payerId: Id,
  specialty: z.string(),
  theme: z.string().optional(),
  codes: z.array(z.string()),
  diagnoses: z.array(z.string()),
  finalStatus: z.enum(["paid", "partially_paid", "refused", "pending"]),
  gross: z.number(),
  paid: z.number(),
  firstPassRefused: z.boolean(),
  refusedCodes: z.array(z.string()),
  refusedLines: z.array(z.object({ code: z.string(), denialCode: z.string(), amount: z.number(), recovered: z.boolean() })),
  fixesApplied: z.array(z.string()),
  daysToCash: z.number().nullable(),
  predictedProbability: z.number().min(0).max(1).nullable(),
  /** Text the embedding was computed from (no identifiers). */
  summary: z.string(),
  embedding: z.unknown().optional(), // BSON Binary float32 vector
  closedAt: IsoDate.nullable(),
  ...Provenance,
});

export const AiCall = z.object({
  _id: Id,
  agent: z.string(),
  provider: z.enum(["groq", "gemini", "none"]),
  model: z.string(),
  promptVersion: z.string(),
  tokensIn: z.number().int(),
  tokensOut: z.number().int(),
  cost: z.number(),
  latencyMs: z.number().int(),
  status: z.enum(["ok", "error", "invalid_output", "timeout", "killed"]),
  fallbackUsed: z.boolean(),
  criticResult: z.enum(["pass", "fail", "skipped"]).optional(),
  guardrailFlags: z.array(z.string()),
  maskingPassed: z.boolean(),
  subject: z.object({ claimId: z.string().optional(), encounterId: z.string().optional() }).optional(),
  error: z.string().optional(),
  at: IsoDate,
});

export const EvalSet = z.object({
  _id: Id,
  name: z.string(),
  claimIds: z.array(Id),
  labels: z.record(z.string(), z.object({ refused: z.boolean(), denialCodes: z.array(z.string()) })),
  createdAt: IsoDate,
});

export const EvalRun = z.object({
  _id: Id,
  evalSetId: Id,
  judge: z.string(),
  precision: z.number(),
  recall: z.number(),
  calibration: z.array(z.object({ bin: z.number(), predicted: z.number(), actual: z.number(), n: z.number() })),
  at: IsoDate,
  n: z.number().int().optional(),
  brier: z.number().optional(),
  auc: z.number().optional(),
  firstPassBaseline: z.number().optional(),
  firstPassWithSeal: z.number().optional(),
  /** Calibration per insurer: raw probability bins → observed refusal rate. */
  byPayer: z.record(z.string(), z.object({ n: z.number(), refused: z.number(), meanPredicted: z.number() })).optional(),
  ruleSetVersion: z.string().optional(),
  activeRules: z.number().int().optional(),
  cycleId: z.string().optional(),
});

export const JudgeConfig = z.object({
  _id: z.literal("judges"),
  active: z.enum(["agentic_llm", "trained_model"]),
  shadow: z.enum(["agentic_llm", "trained_model"]).nullable(),
});

export const Settings = z.object({
  _id: z.literal("settings"),
  insurerDelaySeconds: z.number().int().nonnegative(),
  killSwitches: z.record(z.string(), z.boolean()),
  modelOverrides: z.record(z.string(), z.string()),
  seedVersion: z.string(),
});

/**
 * Mock DHPO post office (plan §6 "logically outside SEAL"). One document per transaction file.
 * Claim files wait here until `readyAt`; the first poll after that runs the mock insurer (lazy delay).
 */
export const MockDhpoTx = z.object({
  _id: Id,
  kind: z.enum(["Claim.Submission", "Remittance.Advice"]),
  senderId: z.string(),
  receiverId: z.string(),
  fileName: z.string(),
  xml: z.string(),
  claimIds: z.array(z.string()),
  uploadedAt: IsoDate,
  readyAt: IsoDate.optional(),
  status: z.enum(["pending_adjudication", "adjudicating", "adjudicated", "available", "downloaded"]),
  /** Remittance file → the claim file it answers (and vice versa). */
  replyTo: z.string().optional(),
  replyId: z.string().optional(),
  downloadedAt: IsoDate.optional(),
});

export const Event = z.object({
  _id: Id,
  seq: z.number().int().positive(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  actor: Actor,
  at: IsoDate,
});

/** Collection names in one place. */
export const COLLECTIONS = {
  patients: "patients",
  members: "members",
  payers: "payers",
  plans: "plans",
  contracts: "contracts",
  providers: "providers",
  encounters: "encounters",
  orders: "orders",
  diagnoses: "diagnoses",
  priorAuths: "priorAuths",
  claims: "claims",
  findings: "findings",
  questionSets: "questionSets",
  rules: "rules",
  ruleProposals: "ruleProposals",
  remittances: "remittances",
  denials: "denials",
  recoveryDrafts: "recoveryDrafts",
  outcomes: "outcomes",
  aiCalls: "aiCalls",
  evalSets: "evalSets",
  evalRuns: "evalRuns",
  judges: "judges",
  settings: "settings",
  events: "events",
  counters: "counters",
  scenarios: "scenarios",
  groundTruth: "groundTruth",
  mockDhpo: "mockDhpo",
  learningCycles: "learningCycles",
} as const;

export type PatientDoc = z.infer<typeof Patient>;
export type MemberDoc = z.infer<typeof Member>;
export type PayerDoc = z.infer<typeof Payer>;
export type PlanDoc = z.infer<typeof Plan>;
export type ContractDoc = z.infer<typeof Contract>;
export type ProviderDoc = z.infer<typeof Provider>;
export type EncounterDoc = z.infer<typeof Encounter>;
export type OrderDoc = z.infer<typeof Order>;
export type DiagnosisDoc = z.infer<typeof Diagnosis>;
export type PriorAuthDoc = z.infer<typeof PriorAuth>;
export type ClaimDoc = z.infer<typeof Claim>;
export type RemittanceDoc = z.infer<typeof Remittance>;
export type DenialDoc = z.infer<typeof Denial>;
export type OutcomeDoc = z.infer<typeof Outcome>;
export type AiCallDoc = z.infer<typeof AiCall>;
export type FindingDoc = z.infer<typeof Finding>;
export type QuestionSetDoc = z.infer<typeof QuestionSet>;
export type RecoveryDraftDoc = z.infer<typeof RecoveryDraft>;
export type EvalRunDoc = z.infer<typeof EvalRun>;
export type RuleProposalDoc = z.infer<typeof RuleProposal>;
export type RuleDocT = z.infer<typeof RuleDoc>;
export type QuestionDoc = z.infer<typeof Question>;
export type SettingsDoc = z.infer<typeof Settings>;
export type EventDoc = z.infer<typeof Event>;
export type MockDhpoTxDoc = z.infer<typeof MockDhpoTx>;
export type ClaimVersionDoc = z.infer<typeof ClaimVersion>;
export type ClaimLineDoc = z.infer<typeof ClaimLine>;
export type DenialCodeFamily = string;
