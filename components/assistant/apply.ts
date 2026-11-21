"use client";

import { assistant, sendToPage, type Proposal } from "./store";

/**
 * Carries out a proposal the person accepted, through SEAL's normal actions (the same ones the
 * screens use), so every change is recorded and re-checked exactly as if it had been typed.
 */
const json = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) throw new Error(j?.error ?? `request failed (${r.status})`);
  return j;
};

export async function applyProposal(p: Proposal, navigate: (path: string) => void) {
  const { page } = assistant.get();
  const a = p.args as Record<string, string>;
  assistant.updateProposal(p.id, { status: "working", note: undefined });
  try {
    switch (p.tool) {
      case "update_note": {
        if (!page.encounterId) throw new Error("Open the patient's visit first.");
        const field = (["complaint", "findings", "plan"].includes(a.field) ? a.field : "complaint") as "complaint" | "findings" | "plan";
        sendToPage({ kind: "note", field, text: a.text ?? "", mode: a.mode === "replace" ? "replace" : "append" });
        break;
      }
      case "add_diagnosis":
        if (!page.encounterId) throw new Error("Open the patient's visit first.");
        await json(`/api/emr/encounters/${page.encounterId}/diagnoses`, { method: "POST", body: JSON.stringify({ icd10: a.icd10 }) });
        sendToPage({ kind: "refresh" });
        break;
      case "add_order":
        if (!page.encounterId) throw new Error("Open the patient's visit first.");
        await json(`/api/emr/encounters/${page.encounterId}/orders`, { method: "POST", body: JSON.stringify({ code: a.code }) });
        sendToPage({ kind: "refresh" });
        break;
      case "remove_order": {
        if (!page.encounterId) throw new Error("Open the patient's visit first.");
        const enc = await json(`/api/emr/encounters/${page.encounterId}`);
        const o = (enc.orders as { _id: string; code: string; justificationStatus: string }[]).find((x) => x.code === a.code && x.justificationStatus !== "removed");
        if (!o) throw new Error(`No ${a.code} order on this visit.`);
        await json(`/api/emr/encounters/${page.encounterId}/orders/${o._id}`, { method: "DELETE" });
        sendToPage({ kind: "refresh" });
        break;
      }
      case "apply_claim_fix": {
        if (!page.claimId) throw new Error("Open the claim first.");
        const { fixes } = await json(`/api/claims/${page.claimId}/fixes`);
        const f = (fixes as { findingId: string; action: { type: string; activityId?: string; quantity?: number; suggestions?: { code: string }[] } }[]).find((x) => x.findingId === a.findingId);
        if (!f) throw new Error("That fix is no longer needed.");
        const body =
          f.action.type === "request_prior_auth" || f.action.type === "remove_line"
            ? { type: f.action.type, activityId: f.action.activityId }
            : f.action.type === "set_quantity"
              ? { type: "set_quantity", activityId: f.action.activityId, quantity: f.action.quantity }
              : f.action.type === "add_diagnosis" && f.action.suggestions?.[0]
                ? { type: "add_diagnosis", code: f.action.suggestions[0].code }
                : null;
        if (!body) throw new Error("This one needs a person: it is on the claim's Fix it panel.");
        await json(`/api/claims/${page.claimId}/fixes`, { method: "POST", body: JSON.stringify(body) });
        break;
      }
      case "answer_question": {
        const setId = a.questionSetId;
        if (!setId) throw new Error("No question set.");
        const cur = await json(`/api/questions/${setId}`);
        const q = (cur.set.questions as { gapId: string; answer?: Record<string, string | number>; fields: { key: string; kind: string }[] }[]).find((x) => x.gapId === a.gapId);
        if (!q) throw new Error("That question is no longer open.");
        const f = q.fields.find((x) => x.key === a.field);
        if (!f) throw new Error("That field is not on the question.");
        const value: string | number = f.kind === "number" && a.value !== "" && !Number.isNaN(Number(a.value)) ? Number(a.value) : String(a.value);
        await json(`/api/questions/${setId}`, { method: "PATCH", headers: { "x-seal-user": cur.set.providerId }, body: JSON.stringify({ gapId: a.gapId, answer: { ...(q.answer ?? {}), [a.field]: value } }) });
        sendToPage({ kind: "answer", setId, gapId: a.gapId, key: a.field, value });
        break;
      }
      case "send_claim": {
        const id = a.claimId || page.claimId;
        if (!id) throw new Error("Which claim?");
        await json(`/api/claims/${id}/submit`, { method: "POST", body: JSON.stringify(a.overrideReason ? { overrideReason: a.overrideReason } : {}) });
        sendToPage({ kind: "refresh" });
        break;
      }
      case "send_ready_claims": {
        const r = await json(`/api/claims?scope=live`);
        const ready = ((r.claims ?? r.rows ?? []) as { _id: string; status: string }[]).filter((c) => c.status === "ready");
        if (!ready.length) throw new Error("No claims are ready to send.");
        let sent = 0;
        for (const c of ready) {
          await json(`/api/claims/${c._id}/submit`, { method: "POST", body: "{}" });
          sent++;
        }
        assistant.updateProposal(p.id, { note: undefined, args: { ...p.args, sent } });
        sendToPage({ kind: "refresh" });
        break;
      }
      case "recheck_claim":
        if (!page.claimId) throw new Error("Open the claim first.");
        await json(`/api/claims/${page.claimId}/check`, { method: "POST" });
        break;
      case "open_page":
        if (!a.path?.startsWith("/")) throw new Error("Unknown page.");
        navigate(a.path);
        break;
      default:
        throw new Error(`Unknown action ${p.tool}`);
    }
    assistant.updateProposal(p.id, { status: "done" });
  } catch (e) {
    assistant.updateProposal(p.id, { status: "failed", note: (e as Error).message });
  }
}
