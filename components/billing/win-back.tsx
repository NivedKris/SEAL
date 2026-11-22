"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Loader2, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { CodePicker } from "@/components/shared/code-picker";
import { CodeChip } from "@/components/shared/code-chip";
import { load, useData } from "@/lib/client/data";
import { REFUSED_COUNT } from "@/lib/client/page-data";
import { aed } from "./risk";
import { cn } from "@/lib/utils";

/** Mirrors lib/recovery/plan.ts (the API's answer). */
type Fix =
  | { type: "request_prior_auth"; activityId: string }
  | { type: "attach_auth"; activityId: string; authNo: string }
  | { type: "set_quantity"; activityId: string; quantity: number }
  | { type: "add_diagnosis"; activityId: string; suggestions: { code: string; description: string }[]; patterns: string[] }
  | { type: "appeal"; activityId: string }
  | { type: "write_off"; activityId: string };
type Refused = { denialId: string; activityId: string; code: string; service: string; denialCode: string; meaning: string; family: string; insurerComment?: string; amount: number; deadline: string; status: string; sealReads?: { rootCause: string; recoverable: boolean; action: string; confidence: string }; recommendation: string; fixes: Fix[]; done: string[] };
type Draft = { id: string; type: "appeal" | "correction"; letter: string; byAI: boolean; rationale?: string; coderReview?: string; evidence: { kind: string; ref: string; quote?: string }[]; flags: string[]; lineEdits: Record<string, { quantity?: number; priorAuthId?: string }>; diagnoses: { code: string; type: "Principal" | "Secondary" }[] | null; activityIds: string[]; changes: string[] };
export type Plan = { claimId: string; claimNo: string; status: string; resubmissionsUsed: number; resubmissionsLeft: number; deadline: string | null; atStake: number; refused: Refused[]; diagnoses: { code: string; type: string; label: string }[]; draft: Draft | null };

const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000)) : null);

/**
 * Win it back: a refused claim on its own page, like a new one. Each refused line with what the
 * insurer said, SEAL's reading, and one-click fixes; they collect into one resubmission whose letter
 * SEAL drafts and a person approves and sends.
 */
export function WinBack({ claimId, payer, onSent }: { claimId: string; payer: string; onSent: () => void }) {
  const { data: plan, reload } = useData<Plan>(`/api/claims/${claimId}/recovery`, { freshMs: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [letter, setLetter] = useState("");
  const [type, setType] = useState<"appeal" | "correction">("appeal");
  const [sent, setSent] = useState(false);
  const draftKey = plan?.draft ? `${plan.draft.id}|${plan.draft.letter.length}` : "";
  useEffect(() => {
    if (plan?.draft) {
      setLetter(plan.draft.letter);
      setType(plan.draft.type);
    }
    // a new draft (or new corrections in it) refreshes the editor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const call = async (what: string, url: string, body?: unknown) => {
    setBusy(what);
    setErr(null);
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-seal-user": "noura-al-mansoori" }, body: body ? JSON.stringify(body) : undefined }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setBusy(null);
    if (r.error) setErr(r.error);
    return r;
  };
  const fix = async (key: string, body: Record<string, unknown>) => {
    const r = await call(key, `/api/claims/${claimId}/recovery`, body);
    if (!r.error) await reload();
  };
  const draftWithSeal = async () => {
    const r = await call("draft", `/api/recovery/${claimId}/draft`);
    if (!r.error) await reload();
  };
  const resubmit = async () => {
    if (!plan?.draft) return;
    const d = plan.draft;
    const r = await call("send", `/api/recovery/drafts/${d.id}/approve`, { type, letter, ...(d.diagnoses ? { diagnoses: d.diagnoses } : {}), lineEdits: d.lineEdits });
    if (!r.error) {
      setSent(true);
      onSent();
      load(REFUSED_COUNT).catch(() => {});
      await reload();
    }
  };

  if (!plan || (!plan.refused.length && !sent)) return null;
  const open = plan.refused.filter((r) => r.status !== "written_off");
  const left = daysLeft(plan.deadline);
  const canSend = !!plan.draft && letter.trim().length >= 10 && open.length > 0 && plan.resubmissionsLeft > 0;

  return (
    <section className="card relative overflow-hidden !rounded-[32px] p-5 md:p-8 text-ink">
      <div className="pointer-events-none absolute -right-20 -top-24 size-80 rounded-full bg-[#f0b45a]/20 blur-3xl" />
      <div className="relative flex flex-wrap items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-[#f0b45a] text-[#2a1a00]">
          <RotateCcw className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="display text-[30px] leading-tight">Win it back</h2>
          <p className="text-[15px] text-ink/55">
            {aed(plan.atStake)} refused by {payer}
            {left !== null && ` · resubmit within ${left} day${left === 1 ? "" : "s"}`} · {plan.resubmissionsUsed} of 2 resubmissions used
          </p>
        </div>
      </div>
      {err && <p className="relative mt-4 rounded-2xl bg-[#c2473c]/10 px-4 py-2.5 text-[14px]">{err}</p>}

      {sent ? (
        <p className="relative mt-6 rounded-2xl bg-seal-mint/40 px-5 py-4 text-[16px]">Resubmitted to {payer}. The insurer&apos;s answer will arrive in Claims, under With the insurer.</p>
      ) : (
        <>
          {/* the refused lines, each with SEAL's fix */}
          <div className="relative mt-6 space-y-3">
            <AnimatePresence initial={false}>
              {plan.refused.map((r, i) => (
                <motion.div key={r.denialId} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.05 } }} className={cn("rounded-3xl p-5 ring-1", r.status === "written_off" ? "bg-white/30 opacity-60 ring-ink/5" : "bg-white/60 ring-ink/10")}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[18px] font-semibold leading-snug">{r.service}</span>
                    <CodeChip code={r.code} />
                    <span className="ml-auto font-mono text-[14px] text-[#b23b31]">{r.denialCode}</span>
                    <span className="dot text-[15px] text-ink/70">{aed(r.amount)}</span>
                  </div>
                  <p className="mt-1.5 text-[14px] text-ink/70">
                    <span className="font-medium text-ink">The insurer says: </span>
                    {r.meaning}
                    {r.insurerComment && <span className="text-ink/55"> · “{r.insurerComment}”</span>}
                  </p>
                  {r.sealReads && (
                    <p className="mt-1 text-[14px] text-ink/70">
                      <span className="font-medium text-ink">SEAL reads: </span>
                      {r.sealReads.rootCause} {r.sealReads.recoverable ? "" : "(likely not recoverable)"}
                    </p>
                  )}
                  <div className="mt-2 text-[15px] text-seal-deep/90">→ {r.recommendation}</div>
                  {r.done.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.done.map((t) => (
                        <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-seal-mint/50 px-3 py-1 text-[13px] text-[#1d6b42]">
                          <Check className="size-3.5" /> {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {r.status !== "written_off" && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {r.fixes.map((f) => {
                        const key = `${f.type}-${f.activityId}`;
                        const primary = "inline-flex items-center gap-2 rounded-full bg-seal-green px-5 py-2.5 text-[15px] font-semibold text-[#06120b] shadow-[0_0_30px_-8px_rgba(62,207,127,0.8)] disabled:opacity-50";
                        const spin = busy === key ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />;
                        if (f.type === "request_prior_auth" && !r.done.some((t) => t.startsWith("Approval")))
                          return (
                            <button key={key} onClick={() => fix(key, { type: f.type, activityId: f.activityId })} disabled={!!busy} className={primary}>
                              {spin} Get the approval
                            </button>
                          );
                        if (f.type === "attach_auth" && !r.done.some((t) => t.startsWith("Approval")))
                          return (
                            <button key={key} onClick={() => fix(key, { type: f.type, activityId: f.activityId, authNo: f.authNo })} disabled={!!busy} className={primary}>
                              {spin} Attach {f.authNo}
                            </button>
                          );
                        if (f.type === "set_quantity" && !r.done.some((t) => t.startsWith("Billing")))
                          return (
                            <button key={key} onClick={() => fix(key, { type: f.type, activityId: f.activityId, quantity: f.quantity })} disabled={!!busy} className={primary}>
                              {spin} Bill the approved {f.quantity}
                            </button>
                          );
                        if (f.type === "add_diagnosis")
                          return (
                            <div key={key} className="w-full space-y-2">
                              <div className="flex flex-wrap gap-2">
                                {f.suggestions.map((s) => (
                                  <button key={s.code} onClick={() => fix(`dx-${s.code}`, { type: "add_diagnosis", code: s.code })} disabled={!!busy} className="rounded-full bg-seal-green px-4 py-2 text-[14px] font-semibold text-[#06120b] disabled:opacity-50">
                                    + {s.description} <span className="font-mono text-[12px] opacity-70">{s.code}</span>
                                  </button>
                                ))}
                              </div>
                              <CodePicker type="icd" patterns={f.patterns} placeholder="Coder: add a documented, qualifying diagnosis" onPick={(code) => fix(`dx-${code}`, { type: "add_diagnosis", code })} block />
                            </div>
                          );
                        if (f.type === "write_off")
                          return (
                            <button key={key} onClick={() => fix(key, { type: f.type, activityId: f.activityId })} disabled={!!busy} className="rounded-full px-4 py-2.5 text-[14px] font-semibold text-ink/60 ring-1 ring-ink/15 hover:text-ink disabled:opacity-50">
                              {busy === key ? <Loader2 className="inline size-4 animate-spin" /> : null} Write it off
                            </button>
                          );
                        if (f.type === "appeal") return <span key={key} className="rounded-full bg-white/70 px-4 py-2 text-[13px] text-ink/60">Covered by the letter below</span>;
                        return null;
                      })}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* the resubmission */}
          {open.length > 0 && (
            <div className="relative mt-6 rounded-3xl bg-white/70 p-5 ring-1 ring-ink/10">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-[17px] font-semibold">The resubmission</div>
                <div className="ml-auto flex gap-1 rounded-full bg-black/[0.04] p-1 text-[13px]">
                  {(["appeal", "correction"] as const).map((t) => (
                    <button key={t} onClick={() => setType(t)} className={cn("rounded-full px-3 py-1", type === t ? "bg-ink text-white" : "text-ink/60")}>
                      {t === "appeal" ? "Appeal" : "Correction"}
                    </button>
                  ))}
                </div>
              </div>
              {plan.draft?.changes.length ? (
                <ul className="mt-3 space-y-1 text-[14px]">
                  {plan.draft.changes.map((c) => (
                    <li key={c} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-seal-deep" /> {c}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px]">
                <span className="text-ink/55">Diagnoses:</span>
                {(plan.draft?.diagnoses ?? plan.diagnoses).map((x) => (
                  <span key={x.code} className="inline-flex items-center gap-1">
                    <CodeChip code={x.code} />
                    {plan.draft?.diagnoses && plan.draft.diagnoses.length > 1 && (
                      <button onClick={() => fix(`rm-${x.code}`, { type: "remove_diagnosis", code: x.code })} className="text-ink/40 hover:text-ink" aria-label={`Remove ${x.code}`}>
                        <X className="size-3.5" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {plan.draft?.coderReview && (
                <p className="mt-3 rounded-2xl bg-[#fff6e6] px-4 py-2.5 text-[13px] text-[#7a5a1c] ring-1 ring-[#f0b45a]/30">
                  <span className="font-medium">For the coder: </span>
                  {plan.draft.coderReview}
                </p>
              )}
              <div className="mt-4 flex items-center justify-between gap-2">
                <div className="text-[13px] font-medium text-ink/70">{type === "appeal" ? "Appeal letter (attached to the resubmission)" : "Resubmission comment"}</div>
                <button onClick={draftWithSeal} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[13px] text-white disabled:opacity-50">
                  {busy === "draft" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} {plan.draft?.byAI ? "Draft again with SEAL" : "Draft the letter with SEAL"}
                </button>
              </div>
              <textarea value={letter} onChange={(e) => setLetter(e.target.value)} rows={8} placeholder="SEAL drafts the letter from the note's own words; you edit it." className="mt-2 w-full resize-y rounded-2xl border border-ink/10 bg-white px-4 py-3 text-[14px] leading-relaxed outline-none focus:border-ink/40" />
              {plan.draft && plan.draft.evidence.length > 0 && (
                <p className="mt-2 text-[12px] text-ink/55">
                  Evidence: {plan.draft.evidence.map((e) => (e.quote ? `“${e.quote}”` : `${e.kind} ${e.ref}`)).join(" · ")}
                  {plan.draft.flags.length > 0 && ` · guardrails applied: ${plan.draft.flags.join(", ").replace(/_/g, " ")}`}
                </p>
              )}
              <button onClick={resubmit} disabled={!!busy || !canSend} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-ink py-3 text-[15px] font-medium text-white disabled:opacity-40">
                {busy === "send" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Resubmit to {payer}
              </button>
              {!plan.draft && <p className="mt-2 text-center text-[12px] text-ink/50">Apply a fix above, or have SEAL draft the letter, to prepare the resubmission.</p>}
              {plan.resubmissionsLeft === 0 && <p className="mt-2 text-center text-[12px] text-[#b23b31]">No resubmissions left under the Dubai directive.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
