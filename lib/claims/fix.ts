import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { z } from "zod";
import { emit } from "@/lib/db/events";
import { COLLECTIONS as C, type ClaimDoc, type EventDoc, type FindingDoc, type PriorAuthDoc, type QuestionSetDoc } from "@/lib/db/schemas";
import { activeRules } from "@/lib/rules/active";
import { codedQualifier } from "@/lib/rules/qualifier";
import { cptLabel, icdLabel, searchIcd } from "@/lib/codes";
import { versionDiagnoses } from "./submit";
import { dubaiIso } from "@/lib/util/time";

/**
 * Fix it here (claim page): one recommended correction per problem SEAL found, applied in one
 * click by a person, then the claim is re-checked. Codes are never chosen by the AI — diagnosis
 * suggestions come from a text search of the official ICD-10-CM list within the rule's qualifying
 * codes, and the coder picks.
 */
export type Fix = {
  findingId: string;
  activityId?: string;
  problem: string;
  recommendation: string;
  action:
    | { type: "request_prior_auth"; activityId: string }
    | { type: "set_quantity"; activityId: string; quantity: number }
    | { type: "remove_line"; activityId: string }
    | { type: "add_diagnosis"; activityId: string; suggestions: { code: string; description: string }[]; patterns: string[] }
    | { type: "ask_doctor"; questionSetId?: string; answered: boolean }
    | { type: "review" };
};

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Common clinical words → the ICD-10-CM family they are indexed under (the tabular wording differs). */
const SYNONYMS: [RegExp, string][] = [
  [/osteopeni/, "M85.8*"],
  [/osteoporo/, "M81*"],
  [/rickets/, "E55.0"],
  [/osteomalacia/, "M83*"],
  [/kidney|renal|ckd/, "N18*"],
  [/vitamin d deficien/, "E55*"],
  [/malabsorp|coeliac|celiac/, "K90*"],
  [/crohn/, "K50*"],
  [/hyperparathyroid/, "E21*"],
  [/obes/, "E66*"],
];

export async function recommendFixes(d: Db, claim: ClaimDoc): Promise<Fix[]> {
  if (!claim.check) return [];
  const [findings, rules, sets] = await Promise.all([
    d.collection(C.findings).find({ claimId: claim._id, checkRun: claim.check.run, status: "open", stage: { $in: ["rule_engine", "critic"] } }).toArray() as unknown as Promise<FindingDoc[]>,
    activeRules(d),
    d.collection(C.questionSets).find({ claimId: claim._id, status: { $ne: "cancelled" } }).sort({ writtenAt: -1 }).toArray() as unknown as Promise<QuestionSetDoc[]>,
  ]);
  const v = claim.versions.at(-1)!;
  const line = (id?: string) => v.lines.find((l) => l.activityId === id);
  const auths = (await d.collection(C.priorAuths).find({ memberId: claim.memberId, status: "approved" }).toArray()) as unknown as PriorAuthDoc[];
  const out: Fix[] = [];
  for (const f of findings) {
    const l = line(f.activityId);
    const name = l ? cptLabel(l.code) : "this line";
    const rule = rules.find((r) => r.id === f.ruleId);
    if (f.stage === "critic") {
      if (!out.some((x) => x.action.type === "review")) out.push({ findingId: f._id, problem: "The second opinion disagreed with SEAL's review", recommendation: "Read the findings below; if you agree the claim is right, release it with a short reason.", action: { type: "review" } });
      continue;
    }
    if (!l) continue;
    if (f.kind === "documentation") {
      const set = sets.find((s) => s.questions.some((q) => q.gapId.endsWith(`-a${l.activityId}`)));
      out.push({
        findingId: f._id,
        activityId: l.activityId,
        problem: `${name}: the note doesn't show what the insurer needs`,
        recommendation: set?.status === "answered" ? "The doctor has answered; SEAL re-checks with the signed addendum." : "SEAL has asked the doctor on their phone. Or remove the line if it shouldn't be billed.",
        action: { type: "ask_doctor", questionSetId: set?._id, answered: set?.status === "answered" },
      });
      continue;
    }
    const qualifier = rule && codedQualifier(rule);
    if (qualifier && f.evidenceSpan) {
      const text = f.evidenceSpan.toLowerCase();
      const words = [...new Set(text.match(/[a-z]{5,}/g) ?? [])];
      const viaSynonym = SYNONYMS.filter(([re, p]) => re.test(text) && qualifier.some((q) => q.replace("*", "").startsWith(p.replace("*", "").slice(0, 3)))).flatMap(([, p]) => searchIcd("", [p], 3));
      const suggestions = [...viaSynonym, ...words.flatMap((w) => searchIcd(w, qualifier, 3))].filter((s, i, a) => a.findIndex((x) => x.code === s.code) === i).slice(0, 4);
      out.push({ findingId: f._id, activityId: l.activityId, problem: `${name}: the note documents a qualifying condition («${f.evidenceSpan}») but it isn't coded`, recommendation: "Add the documented diagnosis to the claim (coder's choice).", action: { type: "add_diagnosis", activityId: l.activityId, suggestions, patterns: qualifier } });
    } else if (rule?.denialCode === "AUTH-001" || f.ruleId === "SEAL-PA-MISSING") {
      out.push({ findingId: f._id, activityId: l.activityId, problem: `${name} needs prior approval and none is on file`, recommendation: `Request approval from the insurer for ${l.quantity > 1 ? `${l.quantity} sessions` : "this service"} and attach it.`, action: { type: "request_prior_auth", activityId: l.activityId } });
    } else if (rule?.denialCode === "AUTH-005" || f.ruleId === "SEAL-PA-QUANTITY") {
      const pa = auths.find((a) => a.authNo === l.priorAuthId);
      if (pa) out.push({ findingId: f._id, activityId: l.activityId, problem: `${name}: billed ${l.quantity}, approval covers ${pa.approvedQty}`, recommendation: `Bill the ${pa.approvedQty} approved and request an extension for the rest.`, action: { type: "set_quantity", activityId: l.activityId, quantity: pa.approvedQty } });
    } else if (rule?.family === "DUPL") {
      out.push({ findingId: f._id, activityId: l.activityId, problem: `${name} was already done recently (${rule.title.toLowerCase()})`, recommendation: "Remove the repeated line from this claim.", action: { type: "remove_line", activityId: l.activityId } });
    } else {
      out.push({ findingId: f._id, activityId: l.activityId, problem: `${name}: ${f.reason ?? rule?.title ?? "may be refused"}`, recommendation: "Remove the line, or release the claim with a reason if you disagree.", action: { type: "remove_line", activityId: l.activityId } });
    }
  }
  // One recommendation per line and type.
  return out.filter((x, i, a) => a.findIndex((y) => y.activityId === x.activityId && y.action.type === x.action.type) === i);
}

export const FixInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("request_prior_auth"), activityId: z.string() }),
  z.object({ type: z.literal("set_quantity"), activityId: z.string(), quantity: z.number().int().positive() }),
  z.object({ type: z.literal("remove_line"), activityId: z.string() }),
  z.object({ type: z.literal("add_diagnosis"), code: z.string() }),
]);

/** Apply one correction to the claim's unsent version (a person clicked it). */
export async function applyFix(d: Db, claimId: string, input: z.infer<typeof FixInput>, actor: EventDoc["actor"]): Promise<ClaimDoc> {
  const claim = (await d.collection(C.claims).findOne({ _id: claimId as never })) as ClaimDoc | null;
  if (!claim) throw new Error(`claim ${claimId} not found`);
  const v = claim.versions.at(-1)!;
  if (v.sentAt) throw new Error("this claim was already sent; correct it from the Refused queue");
  if (!["hold", "ready", "draft"].includes(claim.status)) throw new Error(`claim is ${claim.status}`);
  let lines = [...v.lines];
  let diagnoses = v.diagnoses ?? (await versionDiagnoses(claim, v, d));
  let summary = "";
  const idx = "activityId" in input ? lines.findIndex((l) => l.activityId === input.activityId) : -1;
  if ("activityId" in input && idx < 0) throw new Error("line not found");
  if (input.type === "remove_line") {
    if (lines.length < 2) throw new Error("a claim needs at least one line");
    summary = `Removed ${cptLabel(lines[idx].code)}`;
    lines = lines.filter((_, i) => i !== idx);
  } else if (input.type === "set_quantity") {
    const l = lines[idx];
    const unit = l.net / l.quantity;
    lines[idx] = { ...l, quantity: input.quantity, net: round2(unit * input.quantity) };
    summary = `${cptLabel(l.code)}: quantity ${l.quantity} → ${input.quantity}`;
  } else if (input.type === "request_prior_auth") {
    const l = lines[idx];
    const member = await d.collection(C.members).findOne({ _id: claim.memberId as never });
    const authNo = `PA-${String(member?.payerId ?? "XX").slice(0, 2).toUpperCase()}-B${randomUUID().slice(0, 6).toUpperCase()}`;
    // MOCK insurer: approves at once for the billed quantity.
    await d.collection(C.priorAuths).insertOne({ _id: `pa-${randomUUID()}` as never, memberId: claim.memberId, encounterId: claim.encounterId, codes: [l.code], approvedQty: l.quantity, requestedAt: dubaiIso(), validTo: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), status: "approved", authNo, writtenBy: { kind: "mock_insurer", id: String(member?.payerId) }, writtenAt: dubaiIso() });
    lines[idx] = { ...l, priorAuthId: authNo };
    summary = `Approval ${authNo} attached to ${cptLabel(l.code)}`;
  } else if (input.type === "add_diagnosis") {
    if (icdLabel(input.code) === input.code) throw new Error(`${input.code} is not a billable ICD-10-CM code`);
    if (!diagnoses.some((x) => x.code === input.code)) diagnoses = [...diagnoses, { code: input.code, type: "Secondary" as const }];
    summary = `Added diagnosis ${input.code} ${icdLabel(input.code)}`;
  }
  const net = round2(lines.reduce((s, l) => s + l.net, 0));
  const ratio = claim.gross ? claim.net / claim.gross : 1;
  const gross = round2(ratio ? net / ratio : net);
  await d.collection(C.claims).updateOne(
    { _id: claimId as never, "versions.version": v.version },
    { $set: { "versions.$.lines": lines, "versions.$.diagnoses": diagnoses, net, gross, patientShare: round2(gross - net), liveCheckState: "idle" }, $unset: { "versions.$.xml": "" } },
  );
  await emit("claim.corrected", { claimId, claimNo: claim.claimNo, change: summary }, actor);
  return (await d.collection(C.claims).findOne({ _id: claimId as never })) as unknown as ClaimDoc;
}
