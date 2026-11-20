"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, Loader2, Wrench } from "lucide-react";
import { CodePicker } from "@/components/shared/code-picker";

type Fix = {
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

const LABEL: Record<string, string> = { request_prior_auth: "Request approval", set_quantity: "Bill the approved quantity", remove_line: "Remove this line" };

/** Fix it here: every problem with SEAL's recommended correction, one click each, then an automatic re-check. */
export function FixPanel({ claimId, run, onApplied }: { claimId: string; run?: number; onApplied: () => void }) {
  const [fixes, setFixes] = useState<Fix[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => fetch(`/api/claims/${claimId}/fixes`).then((r) => r.json()).then((r) => setFixes(r.fixes ?? [])), [claimId]);
  useEffect(() => {
    void load();
  }, [load, run]);

  const apply = async (f: Fix, body: Record<string, unknown>) => {
    setBusy(f.findingId);
    setErr(null);
    const r = await fetch(`/api/claims/${claimId}/fixes`, { method: "POST", headers: { "content-type": "application/json", "x-seal-user": "noura-al-mansoori" }, body: JSON.stringify(body) }).then((x) => x.json());
    setBusy(null);
    if (r.error) return setErr(r.error);
    setDone((d) => [...d, f.findingId]);
    onApplied();
  };

  if (!fixes || fixes.length === 0) return null;
  return (
    <section className="relative overflow-hidden rounded-[32px] bg-[#07130d] p-8 text-white ring-1 ring-seal-green/25">
      <div className="pointer-events-none absolute -right-20 -top-24 size-80 rounded-full bg-seal-green/20 blur-3xl" />
      <div className="relative flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-seal-green text-[#06120b]">
          <Wrench className="size-5" />
        </span>
        <div>
          <h2 className="display text-[30px] leading-tight">Fix it here</h2>
          <p className="text-[15px] text-white/55">SEAL&apos;s recommended corrections. One click each, then the claim is checked again.</p>
        </div>
      </div>
      {err && <p className="relative mt-4 rounded-2xl bg-[#ff453a]/20 px-4 py-2.5 text-[14px]">{err}</p>}
      <div className="relative mt-6 space-y-3">
        <AnimatePresence initial={false}>
          {fixes.map((f, i) => {
            const isDone = done.includes(f.findingId);
            return (
              <motion.div key={f.findingId} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.06 } }} className="rounded-3xl bg-white/[0.06] p-5 ring-1 ring-white/10">
                <div className="flex items-start gap-4">
                  <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[13px] font-semibold">{isDone ? <Check className="size-4 text-seal-green" /> : i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[18px] font-semibold leading-snug">{f.problem}</div>
                    <div className="mt-1 text-[15px] text-seal-green/90">→ {f.recommendation}</div>
                    {!isDone && (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {(f.action.type === "request_prior_auth" || f.action.type === "set_quantity" || f.action.type === "remove_line") && (
                          <button onClick={() => apply(f, f.action.type === "set_quantity" ? { type: "set_quantity", activityId: f.action.activityId, quantity: f.action.quantity } : { type: f.action.type, activityId: (f.action as { activityId: string }).activityId })} disabled={!!busy} className="inline-flex items-center gap-2 rounded-full bg-seal-green px-5 py-2.5 text-[15px] font-semibold text-[#06120b] shadow-[0_0_30px_-8px_rgba(62,207,127,0.8)] disabled:opacity-50">
                            {busy === f.findingId ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {LABEL[f.action.type]}
                            {f.action.type === "set_quantity" && ` (${f.action.quantity})`}
                          </button>
                        )}
                        {f.action.type === "add_diagnosis" && (
                          <>
                            {f.action.suggestions.map((s) => (
                              <button key={s.code} onClick={() => apply(f, { type: "add_diagnosis", code: s.code })} disabled={!!busy} className="rounded-full bg-seal-green px-4 py-2 text-[14px] font-semibold text-[#06120b] disabled:opacity-50">
                                + {s.description} <span className="font-mono text-[12px] opacity-70">{s.code}</span>
                              </button>
                            ))}
                            <div className="w-full pt-1">
                              <CodePicker dark type="icd" patterns={f.action.patterns} placeholder="Or search the qualifying codes" onPick={(code) => apply(f, { type: "add_diagnosis", code })} block />
                            </div>
                          </>
                        )}
                        {f.action.type === "ask_doctor" &&
                          (f.action.questionSetId && !f.action.answered ? (
                            <Link href={`/doctor?q=${f.action.questionSetId}`} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-[15px] font-semibold">
                              Waiting for the doctor · open the questions <ArrowRight className="size-4" />
                            </Link>
                          ) : (
                            <span className="rounded-full bg-white/10 px-4 py-2 text-[14px] text-white/70">{f.action.answered ? "Answered by the doctor" : "Questions are being prepared"}</span>
                          ))}
                        {f.action.type === "ask_doctor" && f.activityId && (
                          <button onClick={() => apply(f, { type: "remove_line", activityId: f.activityId! })} disabled={!!busy} className="rounded-full px-4 py-2.5 text-[14px] font-semibold text-white/60 ring-1 ring-white/15 hover:text-white">
                            Remove line instead
                          </button>
                        )}
                        {f.action.type === "review" && <span className="rounded-full bg-white/10 px-4 py-2 text-[14px] text-white/70">Use “Release with a reason” on the right</span>}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}
