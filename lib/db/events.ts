import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./mongo";
import { COLLECTIONS as C, type EventDoc } from "./schemas";

/** Domain event types (plan §5). One per transition. */
export const EVENT_TYPES = [
  "encounter.updated",
  "order.checked",
  "encounter.signed",
  "claim.created",
  "claim.check.started",
  "claim.check.rule_result",
  "claim.check.ai_result",
  "claim.held",
  "questions.created",
  "question.answered",
  "addendum.attached",
  "claim.released",
  "claim.corrected",
  "claim.submitted",
  "remittance.received",
  "denial.queued",
  "draft.ready",
  "resubmission.sent",
  "outcome.recorded",
  "rule.proposed",
  "rule.approved",
  "learning.cycle.completed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Next value of a monotonic counter, atomically, in MongoDB (safe across Vercel instances). */
export async function nextSeq(name = "events"): Promise<number> {
  const d = await db();
  const r = await d
    .collection<{ _id: string; seq: number }>(C.counters)
    .findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return r!.seq;
}

export async function emit(type: EventType, payload: Record<string, unknown>, actor: EventDoc["actor"]): Promise<EventDoc> {
  const ev: EventDoc = { _id: randomUUID(), seq: await nextSeq(), type, payload, actor, at: new Date().toISOString() };
  await (await db()).collection<EventDoc>(C.events).insertOne(ev);
  return ev;
}

/** Events after a cursor, for the 1.5 s polling views. */
export async function eventsSince(since: number, limit = 200): Promise<EventDoc[]> {
  return (await db()).collection<EventDoc>(C.events).find({ seq: { $gt: since } }).sort({ seq: 1 }).limit(limit).toArray();
}
