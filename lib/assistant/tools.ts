import "server-only";
import type { Db } from "mongodb";
import { Type, type FunctionDeclaration } from "@google/genai";
import { COLLECTIONS as C, type ClaimDoc } from "@/lib/db/schemas";
import { loadEncounterBundle } from "@/lib/claims/bundle";
import { recommendFixes } from "@/lib/claims/fix";
import { activeRules } from "@/lib/rules/active";
import { ruleApplies } from "@/lib/rules/engine";
import { cptLabel, icdLabel, searchCpt, searchIcd } from "@/lib/codes";
import { isKnownDenialCode, denialInfo } from "@/lib/claims/denial-codes";
import { todayMetrics } from "@/lib/today/metrics";
import { clinicMetrics } from "@/lib/clinic/metrics";
import { healthMetrics } from "@/lib/health/metrics";
import { hospitalProfile } from "@/lib/hospital/profile";
import { insurerName } from "@/lib/hospital/names";
import { ageAt } from "@/lib/util/time";
import { sharedDb } from "@/lib/db/mongo";

/**
 * SEAL's assistant tools, shared by the text chat and the live voice session.
 * READ tools run at once and return facts from SEAL. WRITE tools never change anything on the
 * server: they come back to the screen as proposals a person accepts or rejects.
 */
export type AssistantContext = { path: string; encounterId?: string; claimId?: string; questionSetId?: string };

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: Type.OBJECT, properties, required }) as FunctionDeclaration["parameters"];
const str = (description: string) => ({ type: Type.STRING, description });

export const READ_TOOLS: FunctionDeclaration[] = [
  { name: "get_context", description: "What is on the user's screen right now: the patient's visit (note, orders, diagnoses, insurer) or the claim (lines, risk, why it is held, recommended fixes). Call this first when the user says 'this patient', 'this claim', 'here' or similar.", parameters: obj({}) },
  { name: "find_claims", description: "List today's live claims, optionally filtered.", parameters: obj({ status: str("hold, ready, submitted, paid, refused or any"), insurer: str("insurer name, optional") }) },
  { name: "explain_code", description: "Explain a medical or refusal code in plain words: CPT service codes, ICD-10 diagnosis codes, or insurer refusal codes like MNEC-003.", parameters: obj({ code: str("the code") }, ["code"]) },
  { name: "search_codes", description: "Find ICD-10 diagnosis or CPT order codes from words, e.g. 'lumbar MRI' or 'type 2 diabetes'.", parameters: obj({ query: str("words to search"), kind: str("diagnosis or order") }, ["query", "kind"]) },
  { name: "insurer_rules", description: "What the insurer requires before paying for a service code (the rules SEAL checks).", parameters: obj({ code: str("CPT code of the service") }, ["code"]) },
  { name: "get_questions", description: "SEAL's open questions for the doctor (what the insurer needs before it will pay) for the patient, claim or question set on screen: each question with its fields (key, kind, label, options, unit) and any answer so far.", parameters: obj({}) },
  { name: "finance_overview", description: "Everything on the Finance screen and more: first-time acceptance (overall and by month), cash at risk, cash recovered, days to cash, refusals by reason and by insurer with amounts, and for hospitals with their own history: totals billed/paid/refused/unpaid, every insurer's refusal rate and top refusal codes, each clinician's rates, resubmission recovery, ageing of unpaid money.", parameters: obj({}) },
  { name: "insights_overview", description: "Everything on the Insights screen: how well SEAL's AI is doing (accuracy and calibration against real outcomes, agreement between the AI and its second opinion, doctors' answer rate), learning (claims ready to learn from, learned rules), AI usage (calls, models, speed, fallbacks, cost per claim), safety checks and alerts.", parameters: obj({}) },
  { name: "claims_breakdown", description: "Today's live claims grouped by insurer, status or doctor, with counts, total value (AED) and average refusal risk. Optionally only one status.", parameters: obj({ by: str("insurer, status or doctor"), status: str("optional: hold, ready, submitted, paid, refused") }, ["by"]) },
  { name: "claim_details", description: "Full detail of any claim by its id or number (e.g. clm-L000004 or L000004): patient, insurer, doctor, lines with risk, status, why held, findings, fixes, payments and refusals.", parameters: obj({ claim: str("claim id or claim number") }, ["claim"]) },
  { name: "refusals_and_appeals", description: "Refused lines waiting to be appealed or resubmitted: claim, code, reason, amount, deadline and days left, sorted by deadline; plus how resubmission has worked out in the hospital's history.", parameters: obj({}) },
  { name: "insurer_profile", description: "Everything about one insurer: live claims with it today, its refusal rate in the hospital's own history and in the regional memory, and what it refuses most.", parameters: obj({ insurer: str("insurer name, e.g. Sukoon or Qatar Insurance") }, ["insurer"]) },
  { name: "doctor_profile", description: "Everything about one doctor or clinician: patients today, open questions, first-time acceptance, and their refusal rate in the hospital's history.", parameters: obj({ doctor: str("doctor's name") }, ["doctor"]) },
  { name: "hospital_summary", description: "Today's numbers for the hospital: claims by stage, money accepted and at risk, insurers, doctors, and the hospital's own history if it has one.", parameters: obj({}) },
];

export const WRITE_TOOLS: FunctionDeclaration[] = [
  { name: "update_note", description: "Write into the doctor's note on the open visit. Only write what the doctor or patient actually said; never invent clinical facts.", parameters: obj({ field: str("complaint (what the patient says), findings (examination), or plan"), text: str("the text to add"), mode: str("append (default) or replace") }, ["field", "text"]) },
  { name: "add_diagnosis", description: "Propose adding an ICD-10 diagnosis to the open visit. Use search_codes first if unsure of the code.", parameters: obj({ icd10: str("ICD-10-CM code"), reason: str("why, in a few words") }, ["icd10"]) },
  { name: "add_order", description: "Propose ordering a test, scan or procedure on the open visit (CPT code). Use search_codes first if unsure.", parameters: obj({ code: str("CPT code"), reason: str("why, in a few words") }, ["code"]) },
  { name: "remove_order", description: "Propose removing an order from the open visit.", parameters: obj({ code: str("CPT code of the order") }, ["code"]) },
  { name: "apply_claim_fix", description: "Propose one of the claim's recommended fixes (from get_context) on the open claim.", parameters: obj({ findingId: str("findingId of the recommended fix"), summary: str("what the fix does, in a few words") }, ["findingId"]) },
  { name: "answer_question", description: "Propose an answer for one field of one of SEAL's questions (from get_questions). Use ONLY what the doctor said or what is already written in the note; if it is not known, ask the doctor instead. The doctor reviews and signs; you never sign.", parameters: obj({ questionSetId: str("questionSetId from get_questions"), gapId: str("gapId of the question"), field: str("the field key"), value: str("the answer; for numbers just the number, for choices one of the options exactly"), label: str("the field's label, for the person to read") }, ["questionSetId", "gapId", "field", "value"]) },
  { name: "send_claim", description: "Propose sending one claim to the insurer. Normally only a 'ready' claim (it passed SEAL's check). Sending a held claim needs the biller's written reason (overrideReason).", parameters: obj({ claimId: str("claim id, e.g. clm-L000014"), overrideReason: str("only for a held claim: the biller's reason for sending anyway") }, ["claimId"]) },
  { name: "send_ready_claims", description: "Propose sending every claim that is ready (passed SEAL's check) to the insurers in one go.", parameters: obj({}) },
  { name: "recheck_claim", description: "Propose re-running SEAL's check on the open claim.", parameters: obj({}) },
  { name: "open_page", description: "Take the user to a screen: /today, /emr, /doctor, /billing, /billing/claims/<id>, /clinic, /rules, /ai-health.", parameters: obj({ path: str("the path") }, ["path"]) },
];
export const ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];

/** Voice only: put the full written answer on screen while a short summary is spoken. Changes nothing. */
export const LIVE_TOOLS: FunctionDeclaration[] = [
  {
    name: "show_details",
    description: "Show the full written answer in the panel while you speak only a short summary. Use it whenever the answer has several numbers, a list, a breakdown or a comparison. Write it like a careful report: short lines starting with '- ', **bold** for the key figures, exact AED amounts, percentages, counts, claim numbers and dates.",
    parameters: obj({ text: str("the full written answer, with '- ' bullet lines and **bold** key figures") }, ["text"]),
  },
];
export const isWriteTool = (name: string) => WRITE_TOOLS.some((t) => t.name === name);

const cut = (s: unknown, n = 600) => (typeof s === "string" && s.length > n ? s.slice(0, n) + "…" : s);

export async function runReadTool(d: Db, name: string, args: Record<string, unknown>, ctx: AssistantContext): Promise<unknown> {
  switch (name) {
    case "get_context":
      return getContext(d, ctx);
    case "get_questions":
      return getQuestions(d, ctx);
    case "finance_overview":
      return financeOverview(d);
    case "insights_overview":
      return insightsOverview(d);
    case "claims_breakdown":
      return claimsBreakdown(d, String(args.by ?? "status"), args.status ? String(args.status) : undefined);
    case "claim_details": {
      const raw = String(args.claim ?? "").trim();
      const c = await d.collection(C.claims).findOne(raw.startsWith("clm-") ? { _id: raw as never } : { claimNo: new RegExp(`${raw.replace(/[^A-Za-z0-9]/g, "")}$`, "i") });
      return c ? getContext(d, { path: "/billing", claimId: String(c._id) }) : { error: `no claim ${raw}` };
    }
    case "refusals_and_appeals":
      return refusals(d);
    case "insurer_profile":
      return insurerProfile(d, String(args.insurer ?? ""));
    case "doctor_profile":
      return doctorProfile(d, String(args.doctor ?? ""));
    case "find_claims": {
      const st = String(args.status ?? "any").toLowerCase();
      const filter: Record<string, unknown> = { claimNo: /-L\d+$/ };
      if (st !== "any" && st !== "") filter.status = st === "with the insurer" ? { $in: ["submitted", "resubmitted"] } : st;
      const claims = (await d.collection(C.claims).find(filter, { projection: { claimNo: 1, status: 1, net: 1, riskScore: 1, payerId: 1, patientId: 1 } }).sort({ createdAt: -1 }).limit(15).toArray()) as unknown as ClaimDoc[];
      const [payers, pats] = await Promise.all([d.collection(C.payers).find({}).toArray(), d.collection(C.patients).find({ _id: { $in: claims.map((c) => c.patientId) as never[] } }, { projection: { name: 1 } }).toArray()]);
      const ins = String(args.insurer ?? "").toLowerCase();
      return claims
        .map((c) => ({ id: c._id, claimNo: c.claimNo, status: c.status, valueAED: c.net, refusalRisk: c.riskScore, insurer: payers.find((p) => String(p._id) === c.payerId)?.name, patient: pats.find((p) => String(p._id) === c.patientId)?.name }))
        .filter((c) => !ins || String(c.insurer ?? "").toLowerCase().includes(ins));
    }
    case "explain_code": {
      const code = String(args.code ?? "").toUpperCase().trim();
      if (/^[A-Z]{3,4}-\d{3}$/.test(code)) return isKnownDenialCode(code) ? { code, type: "insurer refusal code", meaning: denialInfo(code).description, group: denialInfo(code).familyName, usualFix: denialInfo(code).typicalFix } : { code, type: "insurer refusal code", meaning: "not in SEAL's list" };
      if (/^\d{4,5}[A-Z]?$/.test(code)) return { code, type: "CPT service code", meaning: cptLabel(code) };
      return { code, type: "ICD-10 diagnosis code", meaning: icdLabel(code) };
    }
    case "search_codes": {
      const q = String(args.query ?? "");
      return String(args.kind ?? "").startsWith("diag") ? searchIcd(q, [], 8) : searchCpt(q, 8).map((c) => ({ code: c.code, label: c.label }));
    }
    case "insurer_rules": {
      const code = String(args.code ?? "");
      let payerId = "*";
      if (ctx.claimId) payerId = String((await d.collection(C.claims).findOne({ _id: ctx.claimId as never }, { projection: { payerId: 1 } }))?.payerId ?? "*");
      else if (ctx.encounterId) payerId = (await loadEncounterBundle(ctx.encounterId, d).catch(() => null))?.payer._id ?? "*";
      const rules = (await activeRules(d)).filter((r) => (payerId === "*" ? true : ruleApplies(r, payerId, code)) && r.target.codes.some((p) => p === code || (p.endsWith("*") && code.startsWith(p.slice(0, -1)))));
      return { code, service: cptLabel(code), rules: rules.slice(0, 6).map((r) => ({ id: r.id, title: r.title, refusedAs: r.denialCode, insurerNeeds: r.insurerNeeds, source: r.source.publisher })) };
    }
    case "hospital_summary": {
      const [t, hp] = await Promise.all([todayMetrics(d), hospitalProfile(d)]);
      return {
        today: Object.fromEntries(t.thread.map((x) => [x.label, x.n])),
        money: t.money,
        insurers: t.insurers.slice(0, 5),
        doctors: t.doctors.slice(0, 8).map((x) => ({ name: x.name, patientsToday: x.patientsToday, openQuestions: x.openQuestions, firstTimeRate: x.firstTime })),
        needsSomeoneNow: t.needsYou.slice(0, 4).map((x) => `${x.title}: ${x.detail}`),
        hospitalHistory: hp
          ? { hospital: hp.hospital, claims: hp.totals.claims, firstTimeRate: hp.firstTime.rate, rejectedAED: hp.totals.rejected, resubmissionRecovers: hp.resubmission.recoveredShare, insurers: hp.byInsurer.slice(0, 8).map((x) => ({ insurer: insurerName(x.insurer), claims: x.claims, refusedClaimsRate: x.refusedClaimsRate, rejectedAED: x.rejected })) }
          : null,
      };
    }
  }
  return { error: `unknown tool ${name}` };
}

const pct = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1000) / 10);

async function financeOverview(d: Db) {
  const [m, hp] = await Promise.all([clinicMetrics(d), hospitalProfile(d)]);
  return {
    firstTimeAcceptancePct: pct(hp?.firstTime.rate ?? m.firstPass.rate),
    firstTimeByMonth: (hp?.firstTime.byMonth ?? m.firstPass.byMonth).slice(-12).map((x) => ({ month: x.month, claims: x.n, pct: pct(x.rate) })),
    cashAtRiskAED: { heldClaims: m.cashAtRisk.held, refusedStillRecoverable: m.cashAtRisk.refusedOpen },
    recoveredAED: hp ? { byResubmission: hp.resubmission.resubmitted - hp.resubmission.stillRejected, resubmittedClaims: hp.resubmission.claims, recoveredSharePct: pct(hp.resubmission.recoveredShare) } : m.recovered,
    daysToCash: hp ? { medianFromVisit: hp.timing.settleDaysMedian, slowestTenPct: hp.timing.settleDaysP90, visitToSubmissionMedian: hp.timing.submitDaysMedian } : m.daysToCash,
    refusalsByOrderType: hp ? undefined : m.byOrderType.map((x) => ({ type: x.kind, lines: x.lines, refusedPct: pct(x.refusalRate), lostAED: x.lost })),
    topRefusalsByInsurer: hp ? undefined : m.byPayer.map((p) => ({ insurer: p.name, lostAED: p.lost, top: p.top })),
    hospitalHistory: hp
      ? {
          hospital: hp.hospital,
          period: `${hp.totals.from} to ${hp.totals.to}`,
          totalsAED: { billed: hp.totals.submitted, paid: hp.totals.remitted, refused: hp.totals.rejected, stillUnpaid: hp.totals.unsettled, patientShare: hp.totals.deductible },
          claims: hp.totals.claims,
          patients: hp.totals.patients,
          refusedMoneyByReason: hp.byFamily.map((f) => ({ reason: f.family, claims: f.n, AED: f.amount })),
          topRefusalCodes: hp.byCode.slice(0, 10).map((c) => ({ code: c.code, meaning: isKnownDenialCode(c.code) ? denialInfo(c.code).description : undefined, claims: c.n, AED: c.amount })),
          insurers: hp.byInsurer.slice(0, 15).map((x) => ({ insurer: insurerName(x.insurer), claims: x.claims, billedAED: x.submitted, refusedAED: x.rejected, claimsRefusedPct: pct(x.refusedClaimsRate), moneyRefusedPct: pct(x.rejectedShare), topCodes: x.topCodes.map((t) => t.code) })),
          clinicians: hp.byClinician.map((c) => ({ name: c.name, claims: c.claims, claimsRefusedPct: pct(c.refusedClaimsRate), firstTimePct: pct(c.firstTime) })),
          unpaidByAge: hp.ageing,
        }
      : null,
  };
}

async function insightsOverview(d: Db) {
  const [h, hp, imports] = await Promise.all([healthMetrics(d), hospitalProfile(d), d.collection(C.learningCycles).find({ kind: "hospital_history" }).sort({ at: -1 }).limit(1).toArray()]);
  return {
    learnedFromHospitalHistory: hp
      ? { hospital: hp.hospital, claimsLearnedFrom: hp.totals.claims, period: `${hp.totals.from} to ${hp.totals.to}`, inMemoryOfPastClaims: imports[0]?.embedded ?? null, whatItLearned: ["how each of the hospital's insurers treats its claims (refusal rate and top refusal codes per insurer)", "each clinician's refusal rate", "where refused money goes (by reason)", "how much resubmission wins back", "how long money takes to arrive"], firstTimeAcceptancePct: pct(hp.firstTime.rate), claimCheckAdjusts: "every claim's risk is adjusted by how its insurer and doctor have fared in this hospital's own history" }
      : null,
    learning: h.learning,
    aiCalls: h.calls,
    costPerClaimUSD: h.costPerClaim,
    totalCostUSD: h.totalCost,
    operations: (h.operations as unknown as Record<string, unknown>[]).slice(0, 12),
    byProvider: h.byProvider,
    safety: h.safety,
    agreement: h.agreement,
    quality: h.quality,
    calibration: (h.calibration as unknown[]).slice(0, 10),
    drift: h.drift,
    alerts: h.alerts,
  };
}

async function claimsBreakdown(d: Db, by: string, status?: string) {
  const filter: Record<string, unknown> = { claimNo: /-L\d+$/ };
  if (status) filter.status = status;
  const key = by.startsWith("ins") ? "$payerId" : by.startsWith("doc") ? "$providerId" : "$status";
  const rows = await d.collection(C.claims).aggregate([{ $match: filter }, { $group: { _id: key, claims: { $sum: 1 }, valueAED: { $sum: "$net" }, avgRisk: { $avg: "$riskScore" } } }, { $sort: { valueAED: -1 } }]).toArray();
  const names = new Map<string, string>();
  if (key !== "$status") for (const x of await d.collection(key === "$payerId" ? C.payers : C.providers).find({}, { projection: { name: 1 } }).toArray()) names.set(String(x._id), String(x.name));
  return rows.map((r) => ({ [by.startsWith("ins") ? "insurer" : by.startsWith("doc") ? "doctor" : "status"]: names.get(String(r._id)) ?? r._id, claims: r.claims, valueAED: Math.round(r.valueAED * 100) / 100, avgRefusalRiskPct: pct(r.avgRisk) }));
}

async function refusals(d: Db) {
  const [denials, hp] = await Promise.all([d.collection(C.denials).find({ status: { $in: ["queued", "drafted", "resubmitted"] } }).sort({ deadline: 1 }).limit(25).toArray(), hospitalProfile(d)]);
  const claims = await d.collection(C.claims).find({ _id: { $in: denials.map((x) => x.claimId) as never[] } }, { projection: { claimNo: 1 } }).toArray();
  const now = Date.now();
  return {
    waiting: denials.map((x) => ({ claim: claims.find((c) => c._id === x.claimId)?.claimNo, code: x.code, refusal: x.denialCode, meaning: isKnownDenialCode(String(x.denialCode)) ? denialInfo(String(x.denialCode)).description : undefined, amountAED: x.amount, status: x.status, deadline: x.deadline, daysLeft: Math.ceil((Date.parse(String(x.deadline)) - now) / 86_400_000) })),
    history: hp ? { resubmittedClaims: hp.resubmission.claims, resubmittedAED: hp.resubmission.resubmitted, stillRefusedAED: hp.resubmission.stillRejected, recoveredPct: pct(hp.resubmission.recoveredShare) } : null,
  };
}

async function insurerProfile(d: Db, q: string) {
  const t = q.toLowerCase();
  const payers = await d.collection(C.payers).find({}).toArray();
  const p = payers.find((x) => String(x.name).toLowerCase().includes(t) || String(x.hospitalInsurer ?? "").toLowerCase().includes(t));
  const hp = await hospitalProfile(d);
  const hist = hp?.byInsurer.find((x) => insurerName(x.insurer).toLowerCase().includes(t) || x.insurer.toLowerCase().includes(t));
  const live = p ? await d.collection(C.claims).aggregate([{ $match: { claimNo: /-L\d+$/, payerId: p._id } }, { $group: { _id: "$status", n: { $sum: 1 }, valueAED: { $sum: "$net" } } }]).toArray() : [];
  const regional = p ? await (await sharedDb()).collection(C.outcomes).aggregate([{ $match: { payerId: p._id, _id: { $not: /^hx-/ } } }, { $group: { _id: null, n: { $sum: 1 }, refused: { $sum: { $cond: ["$firstPassRefused", 1, 0] } } } }]).toArray() : [];
  if (!p && !hist) return { error: `no insurer matching "${q}"` };
  return {
    insurer: p?.name ?? (hist ? insurerName(hist.insurer) : q),
    liveClaimsToday: live.map((x) => ({ status: x._id, claims: x.n, valueAED: Math.round(x.valueAED) })),
    regionalMemory: regional[0] ? { claims: regional[0].n, refusedFirstTimePct: pct(regional[0].refused / regional[0].n) } : null,
    hospitalHistory: hist ? { claims: hist.claims, billedAED: hist.submitted, refusedAED: hist.rejected, claimsRefusedPct: pct(hist.refusedClaimsRate), moneyRefusedPct: pct(hist.rejectedShare), topRefusals: hist.topCodes.map((c) => ({ code: c.code, meaning: isKnownDenialCode(c.code) ? denialInfo(c.code).description : undefined, claims: c.n, AED: c.amount })) } : null,
  };
}

async function doctorProfile(d: Db, q: string) {
  const t = q.toLowerCase().replace(/^dr\.?\s*/, "");
  const [today, hp] = await Promise.all([todayMetrics(d), hospitalProfile(d)]);
  const doc = today.doctors.find((x) => x.name.toLowerCase().includes(t));
  const hist = hp?.byClinician.find((c) => c.name.toLowerCase().includes(t) || (doc && c.providerId === doc.id));
  if (!doc && !hist) return { error: `no doctor matching "${q}"` };
  return {
    doctor: doc?.name ?? hist?.name,
    today: doc ? { patients: doc.patientsToday, stillWriting: doc.stillWriting, openQuestions: doc.openQuestions, firstTimePct: pct(doc.firstTime) } : null,
    hospitalHistory: hist ? { claims: hist.claims, claimsRefusedPct: pct(hist.refusedClaimsRate), firstTimePct: pct(hist.firstTime) } : null,
  };
}

async function getQuestions(d: Db, ctx: AssistantContext) {
  const filter: Record<string, unknown> = ctx.questionSetId ? { _id: ctx.questionSetId } : ctx.claimId ? { claimId: ctx.claimId, status: "open" } : ctx.encounterId ? { encounterId: ctx.encounterId, status: "open" } : { status: "open" };
  const sets = await d.collection(C.questionSets).find(filter).limit(5).toArray();
  if (!sets.length) return { note: "No open questions from SEAL for this screen." };
  const claims = await d.collection(C.claims).find({ _id: { $in: sets.map((s) => s.claimId) as never[] } }, { projection: { patientId: 1, claimNo: 1, encounterId: 1 } }).toArray();
  const pats = await d.collection(C.patients).find({ _id: { $in: claims.map((c) => c.patientId) as never[] } }, { projection: { name: 1 } }).toArray();
  const encs = await d.collection(C.encounters).find({ _id: { $in: claims.map((c) => c.encounterId) as never[] } }, { projection: { complaint: 1, findings: 1, plan: 1, addenda: 1 } }).toArray();
  return sets.map((s) => {
    const c = claims.find((x) => x._id === s.claimId);
    const e = encs.find((x) => x._id === c?.encounterId);
    return {
      questionSetId: s._id,
      status: s.status,
      patient: pats.find((p) => p._id === c?.patientId)?.name,
      claim: c?.claimNo,
      noteSoFar: e ? { complaint: cut(e.complaint, 400), findings: cut(e.findings, 400), plan: cut(e.plan ?? "", 300) } : null,
      questions: (s.questions as { gapId: string; order?: string; textEn: string; insurerNeeds: string; fields: { key: string; kind: string; labelEn: string; options?: string[]; unit?: string }[]; answer?: Record<string, unknown> }[]).map((q) => ({
        gapId: q.gapId,
        aboutOrder: q.order,
        question: q.textEn,
        insurerNeeds: cut(q.insurerNeeds, 300),
        fields: q.fields.map((f) => ({ key: f.key, kind: f.kind, label: f.labelEn, options: f.options, unit: f.unit })),
        answerSoFar: q.answer ?? {},
      })),
    };
  });
}

async function getContext(d: Db, ctx: AssistantContext) {
  if (ctx.claimId) {
    const claim = (await d.collection(C.claims).findOne({ _id: ctx.claimId as never })) as ClaimDoc | null;
    if (!claim) return { screen: ctx.path, note: "claim not found" };
    const [payer, patient, provider, findings, fixes] = await Promise.all([
      d.collection(C.payers).findOne({ _id: claim.payerId as never }),
      d.collection(C.patients).findOne({ _id: claim.patientId as never }),
      d.collection(C.providers).findOne({ _id: claim.providerId as never }),
      d.collection(C.findings).find({ claimId: claim._id, status: "open" }).toArray(),
      recommendFixes(d, claim).catch(() => []),
    ]);
    const check = (claim as unknown as { check?: { holdReasons?: string[]; lineRisk?: Record<string, number>; hospital?: unknown } }).check;
    return {
      screen: "claim",
      claim: { id: claim._id, claimNo: claim.claimNo, status: claim.status, valueAED: claim.net, refusalRisk: claim.riskScore, insurer: payer?.name, patient: patient?.name, doctor: provider?.name },
      lines: claim.versions.at(-1)!.lines.map((l) => ({ activityId: l.activityId, code: l.code, service: cptLabel(l.code), quantity: l.quantity, valueAED: l.net, refusalRisk: check?.lineRisk?.[l.activityId] })),
      whyHeld: check?.holdReasons ?? [],
      openFindings: findings.slice(0, 6).map((f) => ({ rule: f.ruleId, refusedAs: f.denialCode, insurerNeeds: cut(f.insurerNeeds, 200), reason: cut(f.reason, 200) })),
      recommendedFixes: fixes.map((f) => ({ findingId: f.findingId, problem: f.problem, recommendation: f.recommendation, action: f.action.type })),
      hospitalHistory: check?.hospital ?? null,
    };
  }
  if (ctx.encounterId) {
    const b = await loadEncounterBundle(ctx.encounterId, d);
    return {
      screen: "patient visit",
      patient: { name: b.patient.name, sex: b.patient.sex, age: ageAt(b.patient.dob, Date.now()) },
      insurer: b.payer.name,
      plan: b.plan.name,
      doctor: b.provider.name,
      note: { complaint: cut(b.encounter.complaint), findings: cut(b.encounter.findings), plan: cut(b.encounter.plan ?? "") },
      diagnoses: b.diagnoses.map((x) => ({ icd10: x.icd10, description: x.description, primary: x.primary })),
      orders: b.orders.map((o) => ({ code: o.code, label: o.label, sealStatus: o.justificationStatus })),
      status: b.encounter.status,
    };
  }
  return { screen: ctx.path, note: "No patient or claim is open. Use find_claims or hospital_summary." };
}

export function systemInstruction(hospital: string, ctx: AssistantContext, voice: boolean) {
  return [
    `You are SEAL, the claims assistant inside ${hospital}'s system, used by doctors, coders and the billing team in Dubai.`,
    "SEAL makes sure every order and claim meets the insurer's rules so it is paid the first time.",
    voice
      ? "You are speaking out loud: warm and calm. When the answer has several numbers, a list, a breakdown or a comparison, FIRST call show_details with the full written answer (every figure, '- ' bullets, **bold** key numbers), THEN say only a two or three sentence summary and that the details are on screen. Never read out long lists or IDs."
      : "Match the detail to the question. A quick question gets one to three sentences. When the user asks for details, a breakdown, a comparison, 'why', 'everything' or 'all', answer completely with exact figures (AED amounts, percentages, counts, claim numbers, dates), using short lines that start with '- ' for lists and **bold** for the key number. No headings, no padding.",
    "Screens: /today is the dashboard (hospital_summary). /billing is Claims (claims_breakdown, claim_details, refusals_and_appeals). /clinic is Finance (finance_overview). /ai-health is Insights (insights_overview, finance_overview for the hospital's history). /rules is the insurer rules. Use the matching tools for questions about what is on screen, and combine tools when needed.",
    "Sending claims: a claim marked 'ready' has passed SEAL's check and can be sent; propose send_claim or send_ready_claims. A held claim is only sent with the biller's own written reason.",
    "Use the tools to look things up. Never invent codes, rules, amounts or clinical facts.",
    "To change anything (the note, an order, a diagnosis, a claim fix), call a write tool. It becomes a proposal on screen that the person confirms; say that it is waiting for them.",
    "When a doctor dictates, put the patient's own words in 'complaint', examination in 'findings', and the plan in 'plan'. Write only what was said. Propose diagnoses and orders separately.",
    "SEAL's questions for the doctor (get_questions) are what the insurer needs before it pays. You may propose answers with answer_question, field by field, but ONLY from what the doctor says or what is already in the note. If something is not known, ask the doctor one short question. The doctor reviews and signs the answers; never say they are signed.",
    "If the user speaks Arabic, reply in Arabic; the note stays in English.",
    `Right now the user is on: ${ctx.path}${ctx.encounterId ? ` (a patient visit, id ${ctx.encounterId})` : ""}${ctx.claimId ? ` (claim ${ctx.claimId})` : ""}${ctx.questionSetId ? ` (SEAL's questions for the doctor, set ${ctx.questionSetId})` : ""}.`,
  ].join("\n");
}
