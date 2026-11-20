import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS as C, type ClaimDoc, type EncounterDoc, type MemberDoc, type MockDhpoTxDoc, type PatientDoc, type PayerDoc, type PlanDoc, type PriorAuthDoc, type ProviderDoc, type RemittanceDoc } from "@/lib/db/schemas";
import { parseTransaction } from "@/lib/claims/xml";
import { buildRemittanceAdvice } from "@/lib/claims/xml";
import type { RemittanceAdvice } from "@/lib/claims/schema";
import { SEED_RULES } from "@/lib/rules/library";
import { anyMatch, checkLine, type HistoryItem, type RuleContext } from "@/lib/rules/engine";
import { FACILITY, FILING_DEADLINE_DAYS, MAX_RESUBMISSIONS } from "@/lib/claims/facility";
import { denialInfo } from "@/lib/claims/denial-codes";
import { ageAt, DAY, eclaimDateTime, parseEclaim } from "@/lib/util/time";
import { reviewRecords } from "./records";
import { LAB_CODES, LAB_DX_FIT } from "./tables";

/**
 * MOCK INSURER (plan §5 stage 5, §11). Logically outside SEAL: it receives claim XML from the
 * mock post office and answers with remittance XML. Its rules overlap SEAL's but are not the
 * same — SEAL's public rules enforced with per-family probability, hidden rules SEAL never sees,
 * and noise. Mirrors scripts/seed/sim.ts `adjudicate` so live claims behave like the seeded history.
 * SEAL's agents and rule engine never import this file.
 */

type SubmissionClaim = Extract<ReturnType<typeof parseTransaction>, { kind: "Claim.Submission" }>["data"]["Claim"][number];
type RemitLine = RemittanceAdvice["Claim"][number]["Activity"][number];

// Same constants as the calibrated seed (research/data-report.md).
const ENFORCE: Record<string, number> = { MNEC: 0.88, DUPL: 0.9, AUTH: 0.96, CODE: 0.9, PRCE: 0.8, NCOV: 0.95 };
const PAYER_STRICTNESS: Record<string, number> = { falcon: 1, crescent: 0.95, gulfshield: 0.97, palm: 1.03 };
const HIDDEN_STRICTNESS: Record<string, number> = { falcon: 0.9595, crescent: 0.8611, gulfshield: 0.8122, palm: 0.6654 };
const NOISE_SCALE = 0.8;
const ADMIN_NOISE: [string, number][] = [["CLAI-012", 0.22], ["COPY-001", 0.18], ["PRCE-001", 0.2], ["PRCE-007", 0.12], ["CODE-001", 0.1], ["TIME-001", 0.06], ["ELIG-001", 0.03]];
/** An appeal letter with note evidence persuades the reviewer on its own (hidden) rules this often. */
const APPEAL_PERSUASION = 0.6;
const GS_LIPID_START = Date.parse("2026-09-20T00:00:00+04:00");


type Hidden = { id: string; denialCode: string; p: number; comment: string; applies: (c: SubmissionClaim, code: string, f: Facts) => boolean };
const dxCodes = (c: SubmissionClaim) => c.Diagnosis.map((d) => d.Code);
const HIDDEN: Hidden[] = [
  {
    id: "HIDDEN-CT-ABD-UNSPECIFIED",
    denialCode: "MNEC-003",
    p: 0.7,
    comment: "Abdominal CT not supported by an unspecified abdominal pain diagnosis.",
    applies: (c, code) => anyMatch(["74176-74178"], code) && dxCodes(c).every((d) => anyMatch(["R10.9", "R10.84"], d)),
  },
  {
    id: "HIDDEN-GS-LIPID-12M",
    denialCode: "MNEC-005",
    p: 0.95,
    comment: "Lipid profile repeated within 12 months without diabetes.",
    applies: (c, code, f) =>
      f.payer._id === "gulfshield" &&
      f.at >= GS_LIPID_START &&
      anyMatch(["80061", "83721"], code) &&
      !dxCodes(c).some((d) => anyMatch(["E10*", "E11*", "E13*"], d)) &&
      f.history.some((x) => anyMatch(["80061", "83721"], x.code) && f.at - x.at <= 365 * DAY),
  },
  {
    id: "HIDDEN-PALM-VITD-65",
    denialCode: "MNEC-004",
    p: 0.8,
    comment: "Vitamin D testing over 65 needs a qualifying diagnosis on the claim.",
    applies: (c, code, f) => f.payer._id === "palm" && code === "82306" && f.age >= 65 && !dxCodes(c).some((d) => anyMatch(["E55*", "M80*", "M81*", "M85.8*", "N18*", "K90*"], d)),
  },
  {
    id: "HIDDEN-LAB-DX-FIT",
    denialCode: "MNEC-004",
    p: 0.5,
    comment: "Laboratory test not supported by the diagnoses on the claim.",
    applies: (c, code) => code in LAB_DX_FIT && !dxCodes(c).some((d) => anyMatch(LAB_DX_FIT[code], d)),
  },
  {
    id: "HIDDEN-CRESCENT-ESR-CRP",
    denialCode: "MNEC-006",
    p: 0.2,
    comment: "ESR and CRP billed together; one inflammatory marker is sufficient.",
    applies: (c, code, f) => f.payer._id === "crescent" && code === "85651" && c.Activity.some((a) => a.Code === "86140"),
  },
];

/** Everything the insurer knows about a claim besides the file itself. */
export type Facts = {
  payer: PayerDoc;
  member: MemberDoc | null;
  plan: PlanDoc | null;
  age: number;
  at: number;
  /** When the post office received the file. */
  receivedAt: number;
  specialtyOf: (licence: string) => string;
  history: HistoryItem[];
  priorAuth: (authNo: string | undefined) => PriorAuthDoc | null;
  /** Records the hospital provides on request (note, addenda) plus the resubmission letter. */
  records: string;
  /** Earlier decisions on this claim ID, oldest first: activityId → denial code (undefined = paid). */
  previous: Map<string, string | undefined>[];
};

/** Deterministic uniform [0,1) per decision, so the same file always gets the same answer. */
function rand(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
}

export type LineDecision = { activityId: string; code: string; net: number; paid: number; denialCode?: string; source?: string; comment?: string };

/** Adjudicate one claim from a submission file. Pure given the facts. */
export function adjudicateClaim(c: SubmissionClaim, f: Facts): LineDecision[] {
  const version = f.previous.length + 1;
  const key = `${c.ID}|v${version}`;
  const isAppeal = c.Resubmission?.Type === "internal complaint";
  const payerId = f.payer._id;
  const strictPublic = PAYER_STRICTNESS[payerId] ?? 1;
  const strictHidden = HIDDEN_STRICTNESS[payerId] ?? 1;
  const out: LineDecision[] = c.Activity.map((a) => ({ activityId: a.ID, code: a.Code, net: a.Net, paid: a.Net }));
  const deny = (r: LineDecision, code: string, source: string, comment?: string) => {
    if (r.denialCode) return;
    r.denialCode = code;
    r.paid = code === "PRCE-001" ? Math.round(r.net * 0.8 * 100) / 100 : 0;
    r.source = source;
    r.comment = comment ?? denialInfo(code).description;
  };

  // Over the resubmission limit (Dubai directive): previous decisions stand.
  if (version > MAX_RESUBMISSIONS + 1) {
    const last = f.previous.at(-1)!;
    for (const r of out) {
      const prev = last.get(r.activityId);
      if (prev) deny(r, prev, "resubmission_limit", `Resubmission limit reached (${MAX_RESUBMISSIONS}). Previous decision stands.`);
    }
    return out;
  }
  // A line already paid in full cannot be billed again.
  for (const r of out) if (f.previous.some((p) => p.has(r.activityId) && p.get(r.activityId) === undefined)) deny(r, "DUPL-001", "already_paid");

  if (!f.member) out.forEach((r) => deny(r, "ELIG-001", "eligibility"));
  else if (f.at > Date.parse(`${f.member.validTo}T23:59:59+04:00`) || f.at < Date.parse(`${f.member.validFrom}T00:00:00+04:00`)) out.forEach((r) => deny(r, "ELIG-005", "eligibility"));
  // Resubmissions run on their own clock (the window SEAL tracks per refused line).
  if (version === 1 && f.receivedAt - f.at > FILING_DEADLINE_DAYS * DAY) out.forEach((r) => deny(r, "TIME-001", "filing_deadline"));

  const isEr = [2, 4, 6].includes(c.Encounter.Type);
  const documents = reviewRecords(f.records);
  const lines = c.Activity.map((a) => ({ code: a.Code, quantity: a.Quantity }));
  for (const [i, a] of c.Activity.entries()) {
    const r = out[i];
    const ctx: RuleContext = {
      payerId,
      encounterType: c.Encounter.Type,
      clinicianSpecialty: f.specialtyOf(a.Clinician),
      patientAge: f.age,
      diagnoses: c.Diagnosis.map((d) => ({ code: d.Code, primary: d.Type === "Principal" })),
      lines,
      history: f.history,
      at: f.at,
      benefits: f.plan?.benefits ?? [],
      priorAuthRequired: (code) => !isEr && !!f.plan && anyMatch(f.plan.priorAuthRequired, code),
      priorAuthFor: () => {
        const pa = f.priorAuth(a.PriorAuthorizationID);
        return pa && pa.status === "approved" && anyMatch(pa.codes, a.Code) ? { approvedQty: pa.approvedQty } : null;
      },
      labInHouse: true,
      documents,
    };
    for (const hit of checkLine(SEED_RULES, ctx, { code: a.Code, quantity: a.Quantity }, "claim")) {
      if (hit.fired !== true) continue;
      if (rand(`${key}|${a.ID}|${hit.ruleId}`) < Math.min(0.99, (ENFORCE[hit.rule.family] ?? 0.85) * strictPublic)) deny(r, hit.rule.denialCode, hit.ruleId, `${denialInfo(hit.rule.denialCode).description}: ${hit.rule.title}`);
    }
    for (const h of HIDDEN) {
      if (!h.applies(c, a.Code, f)) continue;
      const p = Math.min(0.99, h.p * strictHidden) * (isAppeal && f.records.length > 0 ? 1 - APPEAL_PERSUASION : 1);
      if (rand(`${key}|${a.ID}|${h.id}`) < p) deny(r, h.denialCode, h.id, h.comment);
    }
    // Clinical noise: a clean lab line refused anyway (appealable). Not on resubmissions.
    const isLab = LAB_CODES.includes(a.Code);
    if (version === 1 && isLab && rand(`${key}|${a.ID}|noise`) < 0.006 * NOISE_SCALE * strictHidden) deny(r, rand(`${key}|${a.ID}|nc`) < 0.5 ? "MNEC-003" : "MNEC-004", "noise_clinical");
  }
  // Administrative noise on first submissions: one line, or the whole claim for ELIG-001.
  if (version === 1 && rand(`${key}|admin`) < 0.022 * NOISE_SCALE) {
    const total = ADMIN_NOISE.reduce((s, [, w]) => s + w, 0);
    let x = rand(`${key}|admin-code`) * total;
    const [code] = ADMIN_NOISE.find(([, w]) => (x -= w) <= 0) ?? ADMIN_NOISE[0];
    if (code === "ELIG-001") out.forEach((r) => deny(r, code, "noise_admin"));
    else deny(out[Math.floor(rand(`${key}|admin-line`) * out.length)], code, "noise_admin");
  }
  return out;
}

/** Gather what the insurer knows about a claim: its own member file, history, approvals and the records. */
export async function loadFacts(c: SubmissionClaim, d: Db, receivedAt: number, opts: { asFirstSubmission?: boolean } = {}): Promise<Facts> {
  const payer = (await d.collection(C.payers).findOne({ eclaimLinkId: c.PayerID })) as PayerDoc | null;
  if (!payer) throw new Error(`unknown payer ${c.PayerID}`);
  const at = parseEclaim(c.Encounter.Start);
  const member = c.MemberID ? ((await d.collection(C.members).findOne({ memberNo: c.MemberID, payerId: payer._id })) as MemberDoc | null) : null;
  const [patient, plan] = await Promise.all([
    member ? (d.collection(C.patients).findOne({ _id: member.patientId as never }) as Promise<PatientDoc | null>) : null,
    member ? (d.collection(C.plans).findOne({ _id: member.planId as never }) as Promise<PlanDoc | null>) : null,
  ]);
  const licences = [...new Set(c.Activity.map((a) => a.Clinician))];
  const providers = (await d.collection(C.providers).find({ licenseNo: { $in: licences } }).toArray()) as unknown as ProviderDoc[];
  const authNos = c.Activity.map((a) => a.PriorAuthorizationID).filter((x): x is string => !!x);
  const auths = authNos.length ? ((await d.collection(C.priorAuths).find({ authNo: { $in: authNos } }).toArray()) as unknown as PriorAuthDoc[]) : [];

  // Records on request: the hospital's claim → encounter note, plus the resubmission letter/attachment.
  const sealClaim = (await d.collection(C.claims).findOne({ claimNo: c.ID }, { projection: { _id: 1, encounterId: 1 } })) as Pick<ClaimDoc, "_id" | "encounterId"> | null;
  const enc = sealClaim ? ((await d.collection(C.encounters).findOne({ _id: sealClaim.encounterId as never }, { projection: { complaint: 1, findings: 1, plan: 1, addenda: 1 } })) as Pick<EncounterDoc, "complaint" | "findings" | "plan" | "addenda"> | null) : null;
  const attachment = c.Resubmission?.Attachment ? Buffer.from(c.Resubmission.Attachment, "base64").toString("utf8") : "";
  const observations = c.Activity.flatMap((a) => (a.Observation ?? []).map((o) => o.Value ?? ""));
  const records = [enc?.complaint, enc?.findings, enc?.plan, ...(enc?.addenda ?? []).map((a) => a.text), ...observations, c.Resubmission?.Comment, attachment].filter(Boolean).join("\n");

  // The member's earlier services billed to this hospital (any outcome), strictly before this visit.
  const history: HistoryItem[] = [];
  if (member) {
    const past = (await d.collection(C.claims).find({ memberId: member._id, claimNo: { $ne: c.ID } }, { projection: { versions: { $slice: 1 }, payerId: 1 } }).toArray()) as unknown as Pick<ClaimDoc, "versions" | "payerId">[];
    for (const p of past) for (const l of p.versions[0].lines) {
      const t = new Date(l.start).getTime();
      if (t < at) history.push({ code: l.code, at: t, payerId: p.payerId });
    }
  }

  // Earlier decisions on this claim ID: remittances this insurer issued (post office files and seeded history).
  const previous: Map<string, string | undefined>[] = [];
  const files = opts.asFirstSubmission ? [] : ((await d.collection(C.mockDhpo).find({ kind: "Remittance.Advice", claimIds: c.ID }).sort({ uploadedAt: 1 }).toArray()) as unknown as MockDhpoTxDoc[]);
  if (sealClaim && !opts.asFirstSubmission) {
    const seeded = (await d.collection(C.remittances).find({ claimId: sealClaim._id, "writtenBy.kind": "seed" }).sort({ claimVersion: 1 }).toArray()) as unknown as RemittanceDoc[];
    for (const r of seeded) previous.push(new Map(r.lines.map((l) => [l.activityId, l.denialCode])));
  }
  for (const f of files) {
    const t = parseTransaction(f.xml);
    if (t.kind !== "Remittance.Advice") continue;
    for (const rc of t.data.Claim.filter((x) => x.ID === c.ID)) previous.push(new Map(rc.Activity.map((a) => [a.ID, a.DenialCode])));
  }

  return {
    payer,
    member,
    plan,
    age: patient ? ageAt(patient.dob, at) : 40,
    at,
    receivedAt,
    specialtyOf: (lic) => providers.find((p) => p.licenseNo === lic)?.specialty ?? "general_practice",
    history,
    priorAuth: (no) => (no ? auths.find((a) => a.authNo === no) ?? null : null),
    records,
    previous,
  };
}

/** Adjudicate a whole Claim.Submission file and answer with one Remittance.Advice file. */
export async function adjudicateFile(xml: string, d: Db, receivedAt: number, now = Date.now()): Promise<{ xml: string; claimIds: string[]; decisions: Record<string, LineDecision[]> }> {
  const tx = parseTransaction(xml);
  if (tx.kind !== "Claim.Submission") throw new Error("the insurer only adjudicates Claim.Submission files");
  const payer = (await d.collection(C.payers).findOne({ eclaimLinkId: tx.data.Header.ReceiverID })) as PayerDoc | null;
  if (!payer) throw new Error(`unknown receiver ${tx.data.Header.ReceiverID}`);
  const decisions: Record<string, LineDecision[]> = {};
  const day = new Date(now + 4 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
  const ra: RemittanceAdvice = {
    Header: { SenderID: payer.eclaimLinkId, ReceiverID: FACILITY.id, TransactionDate: eclaimDateTime(now), RecordCount: tx.data.Claim.length, DispositionFlag: "PRODUCTION" },
    Claim: [],
  };
  for (const c of tx.data.Claim) {
    const facts = await loadFacts(c, d, receivedAt);
    const lines = adjudicateClaim(c, facts);
    decisions[c.ID] = lines;
    ra.Claim.push({
      ID: c.ID,
      IDPayer: `${payer._id.slice(0, 2).toUpperCase()}-CLM-${c.ID.replace(/^SSH-\d{4}-/, "")}`,
      ProviderID: FACILITY.id,
      PaymentReference: `${payer._id.toUpperCase()}-EFT-${day}`,
      DateSettlement: eclaimDateTime(now),
      Encounter: { FacilityID: c.Encounter.FacilityID },
      Activity: c.Activity.map((a, i): RemitLine => ({
        ID: a.ID,
        Start: a.Start,
        Type: a.Type,
        Code: a.Code,
        Quantity: a.Quantity,
        Net: a.Net,
        Clinician: a.Clinician,
        PriorAuthorizationID: a.PriorAuthorizationID,
        PaymentAmount: lines[i].paid,
        DenialCode: lines[i].denialCode,
      })),
    });
  }
  return { xml: buildRemittanceAdvice(ra), claimIds: tx.data.Claim.map((c) => c.ID), decisions };
}
