"use client";

import { SealLoader } from "@/components/brand/seal-loader";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { CodePicker } from "@/components/shared/code-picker";
import { aed } from "./risk";
import { cn } from "@/lib/utils";

type Denial = { _id: string; activityId: string; code: string; denialCode: string; family: string; amount: number; payerComment?: string; deadline: string; status: string; reader?: { rootCause: string; recoverable: boolean; action: string; confidence: string } };
type Draft = { _id: string; type: "appeal" | "correction"; letter: string; evidence: { kind: string; ref: string; quote?: string }[]; coderReview?: string; rationale?: string; flags: string[]; diff?: { lineEdits?: Record<string, { quantity?: number }>; activityIds?: string[] }; sentAt: string | null };
type Dx = { code: string; type: "Principal" | "Secondary" };
type Row = { claimId: string; claimNo: string; scenario?: string; status: string; patientName?: string; payerName?: string; deadline: string; amount: number; resubmissionsUsed: number; denials: Denial[]; draft: Draft | null };
type ClaimDetail = { claim: { versions: { version: number; lines: { activityId: string; code: string; label: string; quantity: number }[]; diagnoses?: { code: string; type: string }[] }[] }; diagnoses: { icd10: string; description?: string; primary: boolean }[] };

const left = (iso: string) => {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.floor(ms / 86_400_000);
  return days >= 1 ? `${days} d left` : `${Math.max(0, Math.floor(ms / 3_600_000))} h left`;
};

export function RecoveryQueue() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/recovery").then((x) => x.json());
    setRows(r.rows ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const row = rows?.find((r) => r.claimId === sel) ?? null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_560px] gap-6">
      <div className="card overflow-hidden !p-0">
        <div className="hidden md:grid md:grid-cols-[140px_1fr_110px_110px_90px] gap-3 border-b border-border bg-secondary/60 px-5 py-2.5 text-[12px] font-medium text-muted-foreground">
          <span>Claim</span>
          <span>Patient · refused</span>
          <span className="text-right">At stake</span>
          <span>Deadline</span>
          <span>Draft</span>
        </div>
        {rows === null && <SealLoader label="Loading refused claims" />}
        <div className="max-h-[640px] overflow-y-auto">
          {rows?.map((r) => (
            <button key={r.claimId} onClick={() => setSel(r.claimId)} className={cn("grid w-full grid-cols-2 md:grid-cols-[140px_1fr_110px_110px_90px] items-center gap-3 border-b border-border/70 px-5 py-3 text-left last:border-0 hover:bg-secondary/50", sel === r.claimId && "bg-secondary")}>
              <span className="font-mono text-[12px]">
                {r.claimNo}
                {r.scenario && <span className="ml-1 rounded border border-border px-1 font-sans text-[10px] text-muted-foreground">{r.scenario}</span>}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{r.patientName}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {r.payerName} · {r.denials.map((x) => `${x.denialCode} on ${x.code}`).join(", ")}
                </span>
              </span>
              <span className="text-right font-mono text-[12px] tabular-nums">{aed(r.amount)}</span>
              <span className={cn("text-[12px]", new Date(r.deadline).getTime() - Date.now() < 7 * 86_400_000 ? "font-medium text-risk-high" : "text-muted-foreground")}>{left(r.deadline)}</span>
              <span className="text-[12px] text-muted-foreground">{r.draft ? (r.draft.sentAt ? "sent" : "ready") : "—"}</span>
            </button>
          ))}
        </div>
      </div>
      <div>{row ? <RecoveryPanel key={row.claimId} row={row} onChanged={load} /> : <div className="rounded-2xl bg-secondary p-5 md:p-8 text-center text-[14px] text-muted-foreground">Pick a refused claim. SEAL drafts the correction or appeal; you edit and approve it.</div>}</div>
    </div>
  );
}

function RecoveryPanel({ row, onChanged }: { row: Row; onChanged: () => void }) {
  const [claim, setClaim] = useState<ClaimDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(row.draft && !row.draft.sentAt ? row.draft : null);
  const [letter, setLetter] = useState(draft?.letter ?? "");
  const [type, setType] = useState<"appeal" | "correction">(draft?.type ?? "appeal");
  const [dx, setDx] = useState<Dx[] | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fetch(`/api/claims/${row.claimId}`).then((r) => r.json()).then(setClaim);
  }, [row.claimId]);
  const v = claim?.claim.versions.at(-1);
  const origDx: Dx[] = (v?.diagnoses as Dx[] | undefined) ?? claim?.diagnoses.map((x): Dx => ({ code: x.icd10, type: x.primary ? "Principal" : "Secondary" })) ?? [];
  const lines = claim ? Object.fromEntries(claim.claim.versions.flatMap((x) => x.lines).map((l) => [l.activityId, l])) : {};

  const makeDraft = async () => {
    setBusy("draft");
    setErr(null);
    const r = await fetch(`/api/recovery/${row.claimId}/draft`, { method: "POST" }).then((x) => x.json());
    setBusy(null);
    if (r.error) return setErr(r.error);
    setDraft(r.draft);
    setLetter(r.draft.letter);
    setType(r.draft.type);
    setQty(Object.fromEntries(Object.entries(r.draft.diff?.lineEdits ?? {}).flatMap(([k, e]) => ((e as { quantity?: number }).quantity ? [[k, (e as { quantity: number }).quantity]] : []))));
  };
  const approve = async () => {
    if (!draft) return;
    setBusy("send");
    setErr(null);
    const body = { type, letter, ...(dx ? { diagnoses: dx } : {}), lineEdits: Object.fromEntries(Object.entries(qty).map(([k, q]) => [k, { quantity: q }])) };
    const r = await fetch(`/api/recovery/drafts/${draft._id}/approve`, { method: "POST", headers: { "content-type": "application/json", "x-seal-user": "noura-al-mansoori" }, body: JSON.stringify(body) }).then((x) => x.json());
    setBusy(null);
    if (r.error) return setErr(r.error);
    setSent(true);
    onChanged();
  };

  return (
    <div className="space-y-4 card p-6">
      <div className="flex items-baseline justify-between">
        <Link href={`/billing/claims/${row.claimId}`} className="font-mono text-[16px] font-semibold hover:underline">
          {row.claimNo}
        </Link>
        <span className="text-[12px] text-muted-foreground">
          {row.resubmissionsUsed} of 2 resubmissions used · resubmit within {left(row.deadline)}
        </span>
      </div>
      {row.denials.map((x) => (
        <div key={x._id} className="rounded-xl bg-risk-high/[0.05] px-4 py-3 text-[13px]">
          <div className="flex items-center gap-2">
            <span className="font-mono">{x.code}</span> {lines[x.activityId]?.label}
            <span className="ml-auto font-mono text-risk-high">{x.denialCode}</span>
          </div>
          <p className="mt-1 text-muted-foreground">{x.payerComment}</p>
          {x.reader && (
            <p className="mt-1.5 text-[12px]">
              <span className="font-medium">Denial reader:</span> {x.reader.rootCause} {x.reader.recoverable ? `Recoverable — ${x.reader.action}.` : "Likely not recoverable."}
            </p>
          )}
        </div>
      ))}
      {err && <p className="rounded-lg bg-risk-high/10 px-3 py-2 text-[12px] text-risk-high">{err}</p>}
      {sent ? (
        <p className="rounded-xl bg-risk-low/10 px-4 py-3 text-[14px] text-risk-low">Resubmitted to the post office. The remittance arrives after the insurer delay.</p>
      ) : !draft ? (
        <button onClick={makeDraft} disabled={!!busy} className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-2.5 text-[14px] font-medium text-background disabled:opacity-50">
          {busy === "draft" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Draft recovery
        </button>
      ) : (
        <>
          <div className="flex gap-2 text-[12px]">
            {(["appeal", "correction"] as const).map((t) => (
              <button key={t} onClick={() => setType(t)} className={cn("rounded-full px-3 py-1", type === t ? "bg-foreground text-background" : "bg-secondary")}>
                {t === "appeal" ? "Appeal" : "Correction"}
              </button>
            ))}
            {draft.rationale && <span className="ml-2 self-center text-muted-foreground">{draft.rationale}</span>}
          </div>
          {draft.coderReview && (
            <div className="rounded-xl border border-risk-mid/40 px-4 py-3 text-[13px]">
              <div className="font-medium text-risk-mid">For the coder to review</div>
              <p className="mt-0.5">{draft.coderReview}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">SEAL never picks codes. Change the diagnoses below only if the note supports it.</p>
            </div>
          )}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[12px] font-medium">
              Diagnoses on the resubmission {dx && <span className="text-risk-mid">changed by coder</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(dx ?? origDx).map((x, i) => (
                <span key={x.code} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-[12px]">
                  <span className="font-mono">{x.code}</span> {x.type === "Principal" ? "principal" : ""}
                  <button onClick={() => setDx((dx ?? origDx).filter((_, j) => j !== i).map((y, j): Dx => ({ ...y, type: j === 0 ? "Principal" : "Secondary" })))} aria-label="Remove">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2">
              <CodePicker type="icd" placeholder="Coder: add a diagnosis (ICD-10-CM)" block onPick={(code) => setDx((cur) => { const base = cur ?? origDx; return base.some((y) => y.code === code) ? base : [...base, { code, type: base.length ? "Secondary" : "Principal" }]; })} />
            </div>
            {dx && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Diff: {origDx.map((x) => x.code).join(", ")} → {dx.map((x) => x.code).join(", ")}
              </p>
            )}
          </div>
          {row.denials.map((x) => (
            <label key={x.activityId} className="flex items-center gap-2 text-[12px]">
              Quantity for {x.code}: <span className="text-muted-foreground">{lines[x.activityId]?.quantity}</span> →
              <input type="number" min={1} value={qty[x.activityId] ?? lines[x.activityId]?.quantity ?? 1} onChange={(e) => setQty((q) => ({ ...q, [x.activityId]: Number(e.target.value) }))} className="w-16 rounded border border-border px-2 py-0.5" />
            </label>
          ))}
          <div>
            <div className="mb-1.5 text-[12px] font-medium">{type === "appeal" ? "Appeal letter (attached to the resubmission)" : "Resubmission comment"}</div>
            <textarea value={letter} onChange={(e) => setLetter(e.target.value)} rows={9} className="w-full resize-y rounded-xl border border-border px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-foreground" />
          </div>
          {draft.evidence.length > 0 && (
            <div className="text-[12px]">
              <div className="font-medium">Evidence</div>
              <ul className="mt-1 space-y-1 text-muted-foreground">
                {draft.evidence.map((e, i) => (
                  <li key={i}>
                    <span className="rounded bg-secondary px-1 font-mono text-[11px] text-foreground">{e.kind}{e.ref && e.ref !== "note" ? ` ${e.ref}` : ""}</span> {e.quote && `“${e.quote}”`}
                  </li>
                ))}
              </ul>
              {draft.flags.length > 0 && <p className="mt-1 text-[11px]">Guardrails applied: {draft.flags.join(", ").replace(/_/g, " ")}.</p>}
            </div>
          )}
          <button onClick={approve} disabled={!!busy || letter.trim().length < 10} className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-2.5 text-[14px] font-medium text-background disabled:opacity-50">
            {busy === "send" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Approve and resubmit
          </button>
        </>
      )}
    </div>
  );
}
