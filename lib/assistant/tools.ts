import "server-only";
import type { Db } from "mongodb";
import { Type, type FunctionDeclaration } from "@google/genai";
import { z } from "zod";
import { COLLECTIONS as C, type ClaimDoc } from "@/lib/db/schemas";
import { loadEncounterBundle } from "@/lib/claims/bundle";
import { recommendFixes } from "@/lib/claims/fix";
import { checkOrders } from "@/lib/check/orders";
import { recoveryPlan } from "@/lib/recovery/plan";
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
import { dubaiIso } from "@/lib/util/time";
import { SCREENS, describeSitemap } from "./sitemap";
import { bestMatches, nameWords } from "./names";

/**
 * SEAL's assistant tools, shared by the text chat and the live voice session.
 * READ tools run at once and return facts from SEAL. WRITE tools never change anything on the
 * server: they come back to the screen as proposals a person accepts or rejects.
 */
/** What is on screen, as the page tells the assistant: its tab and the items listed, in order. */
export type ScreenInfo = { title?: string; tab?: string; items?: { id: string; label: string; kind?: string }[]; details?: string };
export type PendingChange = { id: string; tool: string; args: Record<string, unknown> };
export type AssistantContext = { path: string; encounterId?: string; claimId?: string; questionSetId?: string; screen?: ScreenInfo; pending?: PendingChange[] };
/** The context every assistant request carries (validated). */
export const ContextSchema = z.object({
  path: z.string().max(300),
  encounterId: z.string().max(80).optional(),
  claimId: z.string().max(80).optional(),
  questionSetId: z.string().max(80).optional(),
  screen: z.object({ title: z.string().max(120).optional(), tab: z.string().max(40).optional(), items: z.array(z.object({ id: z.string().max(80), label: z.string().max(200), kind: z.string().max(30).optional() })).max(40).optional(), details: z.string().max(3000).optional() }).optional(),
  pending: z.array(z.object({ id: z.string().max(60), tool: z.string().max(40), args: z.record(z.string(), z.unknown()) })).max(10).optional(),
});

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: Type.OBJECT, properties, required }) as FunctionDeclaration["parameters"];
const str = (description: string) => ({ type: Type.STRING, description });
const num = (description: string) => ({ type: Type.NUMBER, description });
const bool = (description: string) => ({ type: Type.BOOLEAN, description });

export const READ_TOOLS: FunctionDeclaration[] = [
  { name: "get_context", description: "What is on the user's screen right now: the patient's visit (note, orders, diagnoses, insurer) or the claim (lines, risk, why it is held, recommended fixes). Call this first when the user says 'this patient', 'this claim', 'here' or similar.", parameters: obj({}) },
  { name: "search_claims", description: "Find claims: the most recent ones, or by status, insurer, doctor, patient, date or value. Returns each claim's id (use it to open the claim or show the list), number, patient, insurer, doctor, status, value, date, plus how many matched in total. 'My previous/last 10 claims' = sort newest, limit 10.", parameters: obj({ status: str("attention (held), ready, sent (with the insurer), paid, refused, or any"), insurer: str("insurer name, optional"), doctor: str("doctor's name, optional"), patient: str("patient's name, optional"), sinceDays: num("only claims from the last N days, optional"), minAED: num("only claims worth at least this, optional"), sort: str("newest (default), oldest, value or risk"), limit: num("how many, default 10, at most 50"), todayOnly: bool("only today's live claims") }) },
  { name: "find_patient", description: "Find a patient by name: their open or latest visit (visit id, doctor, time) and their latest claims (ids, status). Use it to open someone's visit or claims.", parameters: obj({ name: str("the patient's name, or part of it") }, ["name"]) },
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
  { name: "request_prior_approval", description: "Propose requesting the insurer's prior approval for an order on the open visit (the 'Request approval' fix on SEAL's panel). Use it when SEAL's check says a prior approval is required and none is on file for that order.", parameters: obj({ code: str("CPT code of the order"), service: str("the order's name, e.g. MRI shoulder joint") }, ["code"]) },
  { name: "apply_claim_fix", description: "Propose one of the claim's recommended fixes (from get_context) on the open claim.", parameters: obj({ findingId: str("findingId of the recommended fix"), summary: str("what the fix does, in a few words") }, ["findingId"]) },
  { name: "apply_recovery_fix", description: "On a REFUSED claim (Win it back): propose one fix for a refused line, from that line's fixes in get_context/get_screen: request_prior_auth (get the approval), attach_auth (attach an approval on file), set_quantity (bill the approved quantity), add_diagnosis / remove_diagnosis (coder's choice, only a documented qualifying code), write_off (give up a line that cannot be recovered).", parameters: obj({ claimId: str("claim id; default the open claim"), fix: str("request_prior_auth, attach_auth, set_quantity, add_diagnosis, remove_diagnosis or write_off"), activityId: str("the refused line's activityId (not for diagnoses)"), quantity: num("for set_quantity"), authNo: str("for attach_auth"), code: str("ICD-10 code, for add/remove_diagnosis"), summary: str("what it does, in a few words") }, ["fix"]) },
  { name: "draft_recovery_letter", description: "On a REFUSED claim: propose having SEAL draft the appeal or correction letter for its resubmission, from the note's own words (keeps the fixes already applied).", parameters: obj({ claimId: str("claim id; default the open claim") }) },
  { name: "resubmit_claim", description: "On a REFUSED claim: propose resubmitting it to the insurer with the prepared resubmission (its fixes and letter). Only when the fixes are done and a letter is drafted.", parameters: obj({ claimId: str("claim id; default the open claim"), type: str("appeal or correction, optional") }) },
  { name: "answer_question", description: "Propose an answer for one field of one of SEAL's questions (from get_questions). Use ONLY what the doctor said or what is already written in the note; if it is not known, ask the doctor instead. The doctor reviews and signs; you never sign.", parameters: obj({ questionSetId: str("questionSetId from get_questions"), gapId: str("gapId of the question"), field: str("the field key"), value: str("the answer; for numbers just the number, for choices one of the options exactly"), label: str("the field's label, for the person to read") }, ["questionSetId", "gapId", "field", "value"]) },
  { name: "send_claim", description: "Propose sending one claim to the insurer. Normally only a 'ready' claim (it passed SEAL's check). Sending a held claim needs the biller's written reason (overrideReason).", parameters: obj({ claimId: str("claim id, e.g. clm-L000014"), overrideReason: str("only for a held claim: the biller's reason for sending anyway") }, ["claimId"]) },
  { name: "send_ready_claims", description: "Propose sending every claim that is ready (passed SEAL's check) to the insurers in one go.", parameters: obj({}) },
  { name: "recheck_claim", description: "Propose re-running SEAL's check on the open claim.", parameters: obj({}) },
];
/**
 * SCREEN tools act in the person's browser, at once and without approval: they only move around
 * SEAL or look at what is on screen; they never change a record. confirm_change/reject_change act
 * on a proposal the person has just accepted or declined out loud.
 */
const DEST = {
  screen: str(`where: ${SCREENS.map((x) => x.key).join(", ")}`),
  tab: str("Claims tab: attention, ready, sent, paid or refused"),
  doctor: str("doctor's id (from the names list, doctor_profile or find_patient), to show only their patients or questions"),
  claim: str("a claim id, e.g. clm-L000004 (for screen 'claim')"),
  visit: str("a patient visit id from find_patient (for screen 'patients')"),
  questionSet: str("a question set id (for screen 'questions')"),
  claims: { type: Type.ARRAY, items: { type: Type.STRING }, description: "claim ids from search_claims, to show them as one list on Claims" },
  title: str("heading for that list, e.g. 'Your last 10 claims'"),
  link: str("instead of the fields above: a link an item from get_screen gave, e.g. /billing?tab=ready"),
};
export const SCREEN_TOOLS: FunctionDeclaration[] = [
  { name: "navigate", description: "Take the person to a screen now, already filtered: a Claims tab, one claim, a list of claims, a doctor's patients or questions, a patient's visit. Use when they TELL you to go somewhere or show something ('take me to…', 'open…', 'show me…', 'go to…').", parameters: obj(DEST, ["screen"]) },
  { name: "offer_navigation", description: "Offer to take them somewhere, as a 'Take me there?' button, when they ASK where something is or how to find it. Then ask out loud whether to take them there; if they say yes, call navigate.", parameters: obj({ ...DEST, question: str("what you will ask, e.g. 'They are under Claims, Refused. Shall I take you there?'") }, ["screen", "question"]) },
  { name: "get_screen", description: "What the person is looking at right now: the screen, the tab, and the items listed on it in order (with ids). Call it for 'this one', 'the second one', 'the top claim', 'that patient', 'what am I looking at'.", parameters: obj({}) },
  { name: "go_back", description: "Go back to the previous screen.", parameters: obj({}) },
  { name: "confirm_change", description: "Carry out a change you proposed, ONLY after the person clearly said yes to it (yes, do it, send it, go ahead).", parameters: obj({ proposalId: str("the proposal id you were given") }, ["proposalId"]) },
  { name: "reject_change", description: "Drop a change you proposed because the person said no.", parameters: obj({ proposalId: str("the proposal id") }, ["proposalId"]) },
];
export const SCREEN_TOOL_NAMES = new Set(SCREEN_TOOLS.map((t) => t.name!));
export const isScreenTool = (name: string) => SCREEN_TOOL_NAMES.has(name);

export const ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS, ...SCREEN_TOOLS];

/** Voice only: put the full written answer on screen while a short summary is spoken. Changes nothing. */
export const LIVE_TOOLS: FunctionDeclaration[] = [
  {
    name: "show_details",
    description: "Show the full written answer in the panel while you speak only a short summary. Use it whenever the answer has several numbers, a list, a breakdown or a comparison. Write it like a careful report: short lines starting with '- ', **bold** for the key figures, exact AED amounts, percentages, counts, claim numbers and dates.",
    parameters: obj({ text: str("the full written answer, with '- ' bullet lines and **bold** key figures") }, ["text"]),
  },
];
export const isWriteTool = (name: string) => WRITE_TOOLS.some((t) => t.name === name);
export const WRITE_TOOL_NAMES = WRITE_TOOLS.map((t) => t.name!);

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
    case "search_claims":
      return searchClaims(d, args);
    case "find_patient":
      return findPatient(d, String(args.name ?? ""));
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

const STATUS: Record<string, string[]> = {
  attention: ["hold", "checking"],
  held: ["hold", "checking"],
  hold: ["hold", "checking"],
  ready: ["ready"],
  sent: ["submitted", "resubmitted"],
  submitted: ["submitted", "resubmitted"],
  "with the insurer": ["submitted", "resubmitted"],
  paid: ["paid"],
  refused: ["refused", "partially_paid"],
  rejected: ["refused", "partially_paid"],
  denied: ["refused", "partially_paid"],
};

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The best fits for a spoken name, keeping only those nearly as good as the best one. */
const top = <T,>(said: string, xs: T[], name: (t: T) => string) => {
  const m = bestMatches(said, xs, name);
  return m.filter((x) => x.score >= m[0]?.score - 0.06).map((x) => x.item);
};
const pickDoctors = (provs: { _id: unknown; name?: unknown }[], said: string) => provs.filter((x) => String(x._id) === said).concat(provs.some((x) => String(x._id) === said) ? [] : top(said, provs, (x) => String(x.name)));
const pickPayers = (payers: { _id: unknown; name?: unknown; hospitalInsurer?: unknown }[], said: string) => top(said, payers, (x) => `${x.name} ${x.hospitalInsurer ?? ""}`);

/**
 * Patients whose name fits what was said, best first: anyone in today's clinic, plus a database
 * search on each word of the name (so one misheard word still finds them).
 */
async function patientCandidates(d: Db, said: string) {
  const words = nameWords(said);
  const [byWord, open] = await Promise.all([
    words.length ? d.collection(C.patients).find({ $or: words.map((w) => ({ name: new RegExp(`\\b${esc(w)}`, "i") })) }, { projection: { name: 1 } }).limit(400).toArray() : Promise.resolve([]),
    d.collection(C.encounters).find({ status: "open", evalSet: false }, { projection: { patientId: 1 } }).limit(400).toArray(),
  ]);
  const todays = open.length ? await d.collection(C.patients).find({ _id: { $in: open.map((e) => e.patientId) } }, { projection: { name: 1 } }).toArray() : [];
  const all = [...new Map([...todays, ...byWord].map((p) => [String(p._id), p])).values()];
  return bestMatches(said, all, (p) => String(p.name)).slice(0, 8);
}

async function searchClaims(d: Db, a: Record<string, unknown>) {
  const now = dubaiIso();
  // "Previous" claims: nothing dated after now (the simulated history runs ahead of the clock).
  const filter: Record<string, unknown> = { evalSet: false, createdAt: { $lte: now } };
  const st = String(a.status ?? "any").toLowerCase();
  if (STATUS[st]) filter.status = { $in: STATUS[st] };
  if (a.todayOnly) filter.claimNo = /-L\d+$/;
  if (Number(a.sinceDays) > 0) filter.createdAt = { $lte: now, $gte: dubaiIso(Date.now() - Number(a.sinceDays) * 86_400_000) };
  if (Number(a.minAED) > 0) filter.net = { $gte: Number(a.minAED) };
  const [payers, provs] = await Promise.all([d.collection(C.payers).find({}, { projection: { name: 1 } }).toArray(), d.collection(C.providers).find({}, { projection: { name: 1 } }).toArray()]);
  if (a.insurer) {
    const p = pickPayers(payers, String(a.insurer));
    if (!p.length) return { error: `no insurer matching "${a.insurer}"`, insurers: payers.map((x) => x.name) };
    filter.payerId = { $in: p.map((x) => x._id) };
  }
  if (a.doctor) {
    const p = pickDoctors(provs, String(a.doctor));
    if (!p.length) return { error: `no doctor matching "${a.doctor}"`, doctors: provs.map((x) => x.name) };
    filter.providerId = { $in: p.map((x) => x._id) };
  }
  if (a.patient) {
    const m = await patientCandidates(d, String(a.patient));
    const pats = m.filter((x) => x.score >= (m[0]?.score ?? 1) - 0.06).map((x) => x.item);
    if (!pats.length) return { error: `no patient matching "${a.patient}"` };
    filter.patientId = { $in: pats.map((x) => x._id) };
  }
  const sort: Record<string, 1 | -1> = a.sort === "oldest" ? { createdAt: 1 } : a.sort === "value" ? { net: -1 } : a.sort === "risk" ? { riskScore: -1 } : { createdAt: -1, _id: -1 };
  const limit = Math.min(50, Math.max(1, Number(a.limit) || 10));
  const [claims, total] = await Promise.all([
    d.collection(C.claims).find(filter, { projection: { claimNo: 1, status: 1, net: 1, riskScore: 1, payerId: 1, patientId: 1, providerId: 1, createdAt: 1 } }).sort(sort).limit(limit).toArray(),
    d.collection(C.claims).countDocuments(filter),
  ]);
  const pats = await d.collection(C.patients).find({ _id: { $in: claims.map((c) => c.patientId) } }, { projection: { name: 1 } }).toArray();
  const name = (xs: { _id: unknown; name?: unknown }[], id: unknown) => xs.find((x) => String(x._id) === String(id))?.name;
  return {
    total,
    shown: claims.length,
    claims: claims.map((c) => ({ id: c._id, claimNo: c.claimNo, date: String(c.createdAt).slice(0, 10), status: c.status, valueAED: c.net, refusalRisk: c.riskScore, patient: name(pats, c.patientId), insurer: name(payers, c.payerId), doctor: name(provs, c.providerId) })),
  };
}

async function findPatient(d: Db, q: string) {
  if (!q.trim()) return { error: "whose name?" };
  const m = await patientCandidates(d, q);
  // the best fits only (a misheard surname still finds the right person)
  const pats = m.filter((x) => x.score >= (m[0]?.score ?? 1) - 0.1).slice(0, 6).map((x) => x.item);
  if (!pats.length) return { error: `no patient matching "${q}"` };
  const ids = pats.map((p) => p._id);
  const [encs, claims, provs] = await Promise.all([
    d.collection(C.encounters).find({ patientId: { $in: ids }, evalSet: false }, { projection: { patientId: 1, providerId: 1, start: 1, status: 1 } }).sort({ start: -1 }).limit(30).toArray(),
    d.collection(C.claims).find({ patientId: { $in: ids }, evalSet: false, createdAt: { $lte: dubaiIso() } }, { projection: { patientId: 1, claimNo: 1, status: 1, net: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(30).toArray(),
    d.collection(C.providers).find({}, { projection: { name: 1 } }).toArray(),
  ]);
  const today = dubaiIso().slice(0, 10);
  const rows = pats.map((p) => {
    const mine = encs.filter((e) => e.patientId === p._id);
    const v = mine.find((e) => e.status === "open") ?? mine[0];
    return {
      patient: p.name,
      visit: v ? { id: v._id, openToday: v.status === "open" && String(v.start).slice(0, 10) <= today, open: v.status === "open", at: v.start, doctor: provs.find((x) => x._id === v.providerId)?.name, doctorId: v.providerId } : null,
      claims: claims.filter((c) => c.patientId === p._id).slice(0, 5).map((c) => ({ id: c._id, claimNo: c.claimNo, status: c.status, valueAED: c.net, date: String(c.createdAt).slice(0, 10) })),
    };
  });
  // whoever is in clinic today first, then the most recent visit
  return rows.sort((a, b) => Number(!!b.visit?.open) - Number(!!a.visit?.open) || String(b.visit?.at ?? "").localeCompare(String(a.visit?.at ?? "")));
}

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
  const payers = await d.collection(C.payers).find({}).toArray();
  const p = pickPayers(payers, q)[0];
  const hp = await hospitalProfile(d);
  const hist = hp ? (p ? hp.byInsurer.find((x) => bestMatches(String(p.name), [x], (y) => insurerName(y.insurer)).length) : undefined) ?? top(q, hp.byInsurer, (x) => `${insurerName(x.insurer)} ${x.insurer}`)[0] : undefined;
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
  const [today, hp] = await Promise.all([todayMetrics(d), hospitalProfile(d)]);
  const doc = today.doctors.find((x) => x.id === q) ?? top(q, today.doctors, (x) => x.name)[0];
  const hist = hp?.byClinician.find((c) => doc && c.providerId === doc.id) ?? (hp ? top(q, hp.byClinician, (c) => c.name)[0] : undefined);
  if (!doc && !hist) return { error: `no doctor matching "${q}"`, doctors: today.doctors.map((x) => x.name) };
  return {
    doctor: doc?.name ?? hist?.name,
    id: doc?.id ?? hist?.providerId ?? null,
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
      winItBack: ["refused", "partially_paid"].includes(claim.status)
        ? await recoveryPlan(d, String(claim._id))
            .then((p) => ({
              atStakeAED: p.atStake,
              deadline: p.deadline,
              resubmissionsLeft: p.resubmissionsLeft,
              refusedLines: p.refused.map((r) => ({ activityId: r.activityId, service: `${r.code} ${r.service}`, refusal: `${r.denialCode} ${r.meaning}`, insurerComment: r.insurerComment, sealReads: r.sealReads?.rootCause, recommended: r.recommendation, fixes: r.fixes, done: r.done, writtenOff: r.status === "written_off" })),
              resubmission: p.draft ? { type: p.draft.type, letterBySeal: p.draft.byAI, letter: cut(p.draft.letter, 500), corrections: p.draft.changes, coderReview: p.draft.coderReview } : "not started",
            }))
            .catch(() => null)
        : undefined,
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
      // SEAL's check (the panel on the right): each order supported by the note, or at risk and why
      sealCheck: await checkOrders(ctx.encounterId, d, "rules", {})
        .then((r) =>
          r.orders.map((o) => ({
            order: `${o.label} (${o.code})`,
            status: o.status === "at_risk" ? "AT RISK of refusal" : o.status === "justified" ? "supported by the note" : o.status,
            validApprovalOnFile: b.priorAuths.some((p) => p.status === "approved" && p.codes.includes(o.code) && `${p.validTo}` >= b.encounter.start.slice(0, 10)),
            risks: o.cards.map((c) => ({
              what: c.title,
              refusedAs: c.denialCode,
              insurerNeeds: cut(c.insurerNeeds, 240),
              missingFromNote: c.missing.map((m) => m.text || m.concept),
              fixes: c.fixActions,
              noteTemplates: c.kind === "documentation" ? c.fixTemplates : undefined,
              qualifyingDiagnoses: c.qualifyingCodes?.slice(0, 6),
            })),
          })),
        )
        .catch(() => "not available"),
      priorApprovalsOnFile: b.priorAuths.filter((p) => p.status === "approved").map((p) => ({ authNo: p.authNo, coversOnlyCodes: p.codes, validTo: p.validTo, expiredBeforeThisVisit: `${p.validTo}` < b.encounter.start.slice(0, 10) })),
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
    "Which tool answers what: /today → hospital_summary. Claims → search_claims, claims_breakdown, claim_details, refusals_and_appeals. Finance → finance_overview. Insights → insights_overview. Use the matching tools for questions about what is on screen, and combine tools when needed.",
    "Pick the narrowest tool: a question about one insurer → insurer_profile; one doctor → doctor_profile; one claim → claim_details; one patient → find_patient. Use finance_overview only for the whole hospital, and never attribute hospital-wide figures to a single insurer or doctor.",
    "Sending claims: a claim marked 'ready' has passed SEAL's check and can be sent; propose send_claim or send_ready_claims. A held claim is only sent with the biller's own written reason.",
    describeSitemap(),
    "MOVING AROUND SEAL. Tell commands from questions:",
    "- A command ('take me to…', 'open…', 'show me…', 'go to…', 'pull up…', 'I want to see…', 'let me see…'): do it now with navigate, no need to ask. 'Show me <claims>' ALWAYS puts them on screen: never answer it with a list in words. Navigate even when the list or tab is empty (then say it is empty). Look things up first when needed: 'my last 10 claims' → search_claims(sort newest, limit 10) → navigate(screen claims, claims = their ids, title 'Your last 10 claims'). 'Open claim L4' → navigate(screen claim, claim clm-L000004). 'Show Dr X's patients' → navigate(screen patients, doctor = their id). 'Open Fatima's visit' → find_patient → navigate(screen patients, visit, doctor). 'Refused claims' or 'appeals' or 'what needs appealing' → navigate(screen claims, tab refused). 'What's with the insurer' / 'claims with the insurer' / 'sent' / 'pending' (claims waiting for any insurer's answer, not one insurer) → navigate(screen claims, tab sent). 'Ready to send' → tab ready. 'On hold' / 'needs attention' → tab attention. Claims by insurer, doctor, patient, date, value or 'the five biggest' → search_claims with those filters (limit as asked) → navigate(screen claims, claims = the ids, title saying what they are, e.g. 'Sukoon claims, newest first'). Then say in one short sentence what is on screen now (you may add the total from search_claims).",
    "- A question about where something is ('where can I find…', 'where do I see…', 'how do I get to…'): answer in one sentence (the screen and tab) and call offer_navigation with the same destination. Go only if they say yes (then call navigate). Do not navigate on a question.",
    "- 'This one', 'that claim', 'the second one', 'the top one', 'what am I looking at': call get_screen first, then act on the item they mean. 'Go back' → go_back.",
    "- Names: speech recognition often misspells names ('Omar Hadad', 'Priya Ayer'). Pass the name as you heard it: the tools match close spellings. People listed on screen are usually who they mean, so check get_screen when a name comes up. Never say you can't find someone, or can't go somewhere, before trying the tools; navigate can open any screen on the map.",
    "- Patients: find_patient lists who is in clinic today first (visit.openToday). 'Take me to <patient>' / '<patient>'s visit' means today's open visit when there is one. If several different people match and none is in clinic today, ask which one, naming them. Never guess an id: take ids from the tools.",
    "SEAL'S CHECK ON A VISIT: on Patients, the panel on the right is SEAL checking each order (test, scan, procedure) against the insurer's rules while the doctor writes: supported by the note, or AT RISK of refusal, with what the insurer needs, what is missing from the note, and whether a prior approval is needed. For 'what risks has SEAL flagged', 'is anything at risk', 'what does SEAL say', 'the panel on the right', 'do I need a pre-approval', call get_screen (its details hold the live check) and get_context if needed. Explain each at-risk order in plain words (what the insurer needs, what is missing) and offer to fix it: propose update_note with what the doctor says, or add_diagnosis.",
    "RESOLVING SEAL'S RISKS ('fix it', 'resolve the risk', 'help me with this'): work through each at-risk order with the fix its card offers, and say plainly what you need from the person.",
    "- Prior approval required: an approval counts only if it covers THAT order's code AND is still valid on the visit date. An approval for another service, or an expired one, does not count: say so plainly (e.g. 'the approval on file expired on 11 Nov') and never say a valid one is on file when SEAL flags it missing. SEAL's check is the authority. Propose request_prior_approval for the order.",
    "- Something missing from the note: the card gives a note template with ____ blanks (e.g. 'Symptoms for ____ weeks despite ____'). The values must come from the doctor: ask for each blank in one short question. Never invent or guess a value. When they have said them, propose update_note (field findings, mode append) with the template filled in with their words. If they would rather type, tell them the card on the right has the blanks to fill.",
    "- A diagnosis would qualify: propose add_diagnosis with one of the qualifying codes, but only one the doctor confirms or that is clearly documented.",
    "- Or the order can be removed (remove_order) if the doctor decides it is not needed.",
    "CLAIMS. A held claim: get_context lists SEAL's 'Fix it here' fixes; propose apply_claim_fix for each, then send_claim when it is ready. A REFUSED claim ('win it back', 'fix the refusal', 'appeal', 'resubmit'): open it (navigate screen claim) if it is not on screen, then get_context (winItBack). For each refused line explain what the insurer said and SEAL's recommended fix, and propose apply_recovery_fix with that line's fix (get the approval, attach it, bill the approved quantity, add a documented diagnosis the coder confirms, or write off a line that cannot be recovered). Then propose draft_recovery_letter, and when the letter is ready, resubmit_claim. One step at a time, each waiting for their yes. Refusals waiting across the hospital: refusals_and_appeals, or navigate to Claims, tab refused.",
    "Use the tools to look things up. Never invent codes, rules, amounts or clinical facts.",
    "CHANGES (the note, an order, a diagnosis, a claim fix, an answer, sending a claim): call the write tool. It appears on screen as a card with a proposalId and changes nothing yet. Ask them in a few words whether to go ahead (e.g. 'Shall I send it?'). ONLY when they clearly say yes (yes, do it, send it, go ahead), call confirm_change with that proposalId; if they say no, call reject_change. Never confirm on your own, never confirm something they did not just agree to, and never say a change is done before confirm_change says so.",
    "Use the tools to look things up. Never invent codes, rules, amounts or clinical facts.",
    "When a doctor dictates, put the patient's own words in 'complaint', examination in 'findings', and the plan in 'plan'. Write only what was said. Propose diagnoses and orders separately.",
    "SEAL's questions for the doctor (get_questions) are what the insurer needs before it pays. You may propose answers with answer_question, field by field, but ONLY from what the doctor says or what is already in the note. If something is not known, ask the doctor one short question. The doctor reviews and signs the answers; never say they are signed.",
    "Language: always reply in English. Only if the person speaks Arabic, reply in Arabic. Never reply in any other language, even if the speech sounds like one. The note always stays in English.",
    `Right now the user is on: ${ctx.path}${ctx.encounterId ? ` (a patient visit, id ${ctx.encounterId})` : ""}${ctx.claimId ? ` (claim ${ctx.claimId})` : ""}${ctx.questionSetId ? ` (SEAL's questions for the doctor, set ${ctx.questionSetId})` : ""}${ctx.screen?.title ? `, "${ctx.screen.title}"${ctx.screen.tab ? ` (tab ${ctx.screen.tab})` : ""} with ${ctx.screen.items?.length ?? 0} items listed (get_screen has them)` : ""}.`,
    ctx.pending?.length ? `Changes waiting for the person's yes or no: ${ctx.pending.map((p) => `${p.id} = ${p.tool} ${JSON.stringify(p.args).slice(0, 160)}`).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The insurers and doctors (with ids) people will name, so a misheard name still resolves and navigate gets real ids. */
export async function namesHint(d: Db) {
  const [payers, providers, hp] = await Promise.all([d.collection(C.payers).find({}, { projection: { name: 1 } }).toArray(), d.collection(C.providers).find({}, { projection: { name: 1 } }).toArray(), hospitalProfile(d)]);
  const insurers = [...new Set([...payers.map((p) => String(p.name)), ...(hp?.byInsurer.slice(0, 15).map((x) => insurerName(x.insurer)) ?? [])])];
  // today's clinic: the patients people are most likely to name
  const open = await d.collection(C.encounters).find({ status: "open", evalSet: false }, { projection: { patientId: 1 } }).limit(150).toArray();
  const pats = open.length ? await d.collection(C.patients).find({ _id: { $in: open.map((e) => e.patientId) } }, { projection: { name: 1 } }).toArray() : [];
  return `\nNames people may say (match what you hear to these, even if it sounds slightly different): insurers ${insurers.join(", ")}; doctors ${providers.map((p) => `${p.name} (id ${p._id})`).join(", ")}; patients in clinic today ${pats.map((p) => p.name).join(", ")}. Claims are named like "L000004" ("L four"), id clm-L000004.`;
}

/** get_screen, answered from what the page reported. */
export function screenAnswer(ctx: AssistantContext) {
  return { path: ctx.path, title: ctx.screen?.title ?? null, tab: ctx.screen?.tab ?? null, details: ctx.screen?.details ?? null, items: (ctx.screen?.items ?? []).map((x, i) => ({ n: i + 1, ...x })), openClaim: ctx.claimId ?? null, openVisit: ctx.encounterId ?? null, waitingChanges: ctx.pending ?? [] };
}
