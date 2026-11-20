import { z } from "zod";

/**
 * DHA eClaimLink (DHPO) transaction schemas — Claim.Submission and Remittance.Advice.
 *
 * Field formats, enums and lengths come from the DHA CommonTypes.xsd (v2.0); which
 * fields are required comes from the Green Rain Health DHA templates. See
 * research/R1/sources.md for every source and the open questions.
 *
 * Dates are eClaimLink strings, not ISO: "dd/mm/yyyy" and "dd/mm/yyyy HH:MM".
 */

// ── CommonTypes primitives ────────────────────────────────────────────────
export const DateForm = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, "dd/mm/yyyy");
export const DateTimeForm = z.string().regex(/^\d{2}\/\d{2}\/\d{4} (20|21|22|23|[0-1]?\d):[0-5]?\d$/, "dd/mm/yyyy HH:MM");
/** eClaimLink IDs: non-empty, no whitespace. */
const NoSpace = z.string().min(1).regex(/^\S*$/, "no whitespace");
/** NNN-NNNN-NNNNNNN-N, incl. the placeholder values for people without a card. */
export const EmiratesIDNumber = z.string().regex(/^\d{3}-\d{4}-\d{7}-\d$/, "NNN-NNNN-NNNNNNN-N");
export const EMIRATES_ID_PLACEHOLDERS = {
  nationalWithoutCard: "000-0000-0000000-0",
  expatResidentWithoutCard: "111-1111-1111111-1",
  nonNationalNonResidentWithoutCard: "222-2222-2222222-2",
  unknownWithoutCard: "999-9999-9999999-9",
} as const;
const Amount = z.number().finite();

// ── Enumerations ──────────────────────────────────────────────────────────
/** CommonTypes.xsd lists 1-9, 12, 13, 15; Green Rain's current template adds 10, 41, 42. */
export const EncounterType = z.union(
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 15, 41, 42].map((n) => z.literal(n)) as unknown as [z.ZodLiteral<number>, z.ZodLiteral<number>, ...z.ZodLiteral<number>[]],
);
export const ENCOUNTER_TYPE_LABELS: Record<number, string> = {
  1: "No bed + no emergency room",
  2: "No bed + emergency room",
  3: "Inpatient bed + no emergency room",
  4: "Inpatient bed + emergency room",
  5: "Daycase bed + no emergency room",
  6: "Daycase bed + emergency room",
  7: "Nationals screening",
  8: "New visa screening",
  9: "Renewal visa screening",
  10: "Pre-op test procedures",
  12: "Home",
  13: "Assisted living facility",
  15: "Mobile unit",
  41: "Ambulance - land",
  42: "Ambulance - air or water",
};
export const EncounterStartType = z.union([1, 2, 3, 4, 5, 6, 7].map((n) => z.literal(n)) as unknown as [z.ZodLiteral<number>, z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]);
export const EncounterEndType = EncounterStartType;
/** 3 CPT · 4 HCPCS · 5 Drug · 6 Dental · 8 Service code · 9 DRG · 10 Scientific code. */
export const ActivityType = z.union([3, 4, 5, 6, 8, 9, 10].map((n) => z.literal(n)) as unknown as [z.ZodLiteral<number>, z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]);
export const DiagnosisType = z.enum(["Principal", "Secondary", "Admitting"]);
export const ObservationType = z.enum(["LOINC", "Text", "File", "Universal Dental", "Financial", "Grouping", "eRx", "Result", "ROM", "ExcludeFromDRG"]);
export const ResubmissionType = z.enum(["correction", "internal complaint", "legacy"]);
export const DispositionFlag = z.enum(["TEST", "PRODUCTION"]);
export const DenialCode = z.string().regex(/^[A-Z]{3,4}-\d{3}$/);

// ── Shared ────────────────────────────────────────────────────────────────
export const Header = z.object({
  SenderID: NoSpace.max(20),
  ReceiverID: NoSpace.max(20),
  TransactionDate: DateTimeForm,
  /** Number of Claim elements in the file. */
  RecordCount: z.number().int().nonnegative(),
  DispositionFlag,
});

export const Observation = z.object({
  Type: ObservationType,
  Code: z.string().max(500),
  Value: z.string().optional(),
  ValueType: z.string().optional(),
});

// ── Claim.Submission ──────────────────────────────────────────────────────
export const SubmissionEncounter = z.object({
  FacilityID: NoSpace,
  Type: EncounterType,
  PatientID: z.string().min(1).max(30),
  Start: DateTimeForm,
  End: DateTimeForm.optional(),
  StartType: EncounterStartType.optional(),
  EndType: EncounterEndType.optional(),
  TransferSource: z.string().max(100).optional(),
  TransferDestination: z.string().max(100).optional(),
});

export const Diagnosis = z.object({
  Type: DiagnosisType,
  /** ICD-10-CM, written with the dot as in eClaimLink files (e.g. "M54.50"). */
  Code: NoSpace,
  DxInfo: z.array(z.object({ Type: z.literal("POA"), Code: z.enum(["Y", "N", "U", "W", "1", "OP"]) })).optional(),
});

export const SubmissionActivity = z.object({
  ID: z.string().min(1).max(20),
  Start: DateTimeForm,
  Type: ActivityType,
  Code: NoSpace,
  Quantity: z.number().min(0),
  Net: Amount,
  Clinician: NoSpace,
  PriorAuthorizationID: z.string().max(50).optional(),
  Observation: z.array(Observation).optional(),
});

export const Resubmission = z.object({
  Type: ResubmissionType,
  Comment: z.string().min(1),
  /** base64 PDF */
  Attachment: z.string().optional(),
});

export const SubmissionClaim = z
  .object({
    ID: z.string().min(1).max(100),
    IDPayer: z.string().max(50).optional(),
    MemberID: z.string().max(50).optional(),
    PayerID: NoSpace,
    ProviderID: NoSpace,
    EmiratesIDNumber,
    Gross: Amount,
    PatientShare: Amount,
    Net: Amount,
    Encounter: SubmissionEncounter,
    Diagnosis: z.array(Diagnosis).min(1),
    Activity: z.array(SubmissionActivity).min(1),
    Resubmission: Resubmission.optional(),
    Contract: z.object({ PackageName: z.string() }).optional(),
  })
  // SEAL consistency checks (derived from the CommonTypes field definitions, not stated XSD rules).
  .superRefine((c, ctx) => {
    const principals = c.Diagnosis.filter((d) => d.Type === "Principal").length;
    if (principals !== 1) ctx.addIssue({ code: "custom", path: ["Diagnosis"], message: `exactly one Principal diagnosis required, found ${principals}` });
    const ids = new Set<string>();
    for (const a of c.Activity) {
      if (ids.has(a.ID)) ctx.addIssue({ code: "custom", path: ["Activity"], message: `duplicate Activity ID ${a.ID}` });
      ids.add(a.ID);
    }
    const sumNet = round2(c.Activity.reduce((s, a) => s + a.Net, 0));
    if (Math.abs(sumNet - c.Net) > 0.01) ctx.addIssue({ code: "custom", path: ["Net"], message: `Claim.Net ${c.Net} ≠ sum of Activity.Net ${sumNet}` });
    if (Math.abs(round2(c.Gross - c.PatientShare) - c.Net) > 0.01)
      ctx.addIssue({ code: "custom", path: ["Gross"], message: "Gross − PatientShare must equal Net" });
  });

export const ClaimSubmission = z
  .object({ Header, Claim: z.array(SubmissionClaim).min(1) })
  .superRefine((t, ctx) => {
    if (t.Header.RecordCount !== t.Claim.length)
      ctx.addIssue({ code: "custom", path: ["Header", "RecordCount"], message: `RecordCount ${t.Header.RecordCount} ≠ ${t.Claim.length} claims` });
  });
export type ClaimSubmission = z.infer<typeof ClaimSubmission>;

// ── Remittance.Advice ─────────────────────────────────────────────────────
export const RemittanceActivity = z.object({
  ID: z.string().min(1).max(20),
  Start: DateTimeForm,
  Type: ActivityType,
  Code: NoSpace,
  Quantity: z.number().min(0),
  Net: Amount,
  List: z.number().min(0).optional(),
  Clinician: NoSpace,
  PriorAuthorizationID: z.string().max(50).optional(),
  Gross: Amount.optional(),
  PatientShare: Amount.optional(),
  PaymentAmount: Amount,
  DenialCode: DenialCode.optional(),
});

export const RemittanceClaim = z.object({
  ID: z.string().min(1).max(100),
  IDPayer: z.string().min(1).max(50),
  ProviderID: NoSpace.optional(),
  DenialCode: DenialCode.optional(),
  PaymentReference: z.string().min(1),
  DateSettlement: DateTimeForm.optional(),
  Encounter: z.object({ FacilityID: NoSpace }).optional(),
  Activity: z.array(RemittanceActivity).min(1),
});

export const RemittanceAdvice = z
  .object({ Header, Claim: z.array(RemittanceClaim).min(1) })
  .superRefine((t, ctx) => {
    if (t.Header.RecordCount !== t.Claim.length)
      ctx.addIssue({ code: "custom", path: ["Header", "RecordCount"], message: `RecordCount ${t.Header.RecordCount} ≠ ${t.Claim.length} claims` });
    t.Claim.forEach((c, i) =>
      c.Activity.forEach((a, j) => {
        if (a.PaymentAmount < a.Net - 0.01 && !a.DenialCode)
          ctx.addIssue({ code: "custom", path: ["Claim", i, "Activity", j, "DenialCode"], message: `activity ${a.ID} paid less than Net without a DenialCode` });
      }),
    );
  });
export type RemittanceAdvice = z.infer<typeof RemittanceAdvice>;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
