"use client";

import { SealLoader } from "@/components/brand/seal-loader";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { aed } from "./risk";
import { cn } from "@/lib/utils";
import { useAssistantScreen } from "@/components/assistant/store";

type ListRow = { claimId: string; claimNo: string; scenario?: string; status: string; patientName?: string; payerName?: string; deadline: string; amount: number; resubmissionsUsed: number; lines: { denialCode: string; code: string }[]; draft: { sentAt: string | null } | null };
const PAGE = 60;

const left = (iso: string) => {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.floor(ms / 86_400_000);
  return days >= 1 ? `${days} d left` : `${Math.max(0, Math.floor(ms / 3_600_000))} h left`;
};

export function RecoveryQueue() {
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [more, setMore] = useState(false);
  const load = useCallback(async (n?: number) => {
    const r = await fetch(`/api/recovery?limit=${n ?? PAGE}`).then((x) => x.json());
    setRows(r.rows ?? []);
    setTotal(r.total?.claims ?? 0);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const showMore = async () => {
    if (!rows) return;
    setMore(true);
    const r = await fetch(`/api/recovery?limit=${PAGE}&offset=${rows.length}`).then((x) => x.json());
    setRows([...rows, ...(r.rows ?? [])]);
    setMore(false);
  };
  useAssistantScreen(rows && { title: "Claims", tab: "Refused", items: rows.slice(0, 40).map((r) => ({ id: r.claimId, kind: "claim", label: `${r.claimNo} · ${r.patientName ?? ""} · ${r.payerName ?? ""} · AED ${r.amount} at stake · ${r.lines.map((l) => l.denialCode).join(", ")} · deadline ${r.deadline.slice(0, 10)}` })) });

  // Each refused claim opens on its own claim page (Win it back), like a new claim.
  return (
    <div className="card overflow-hidden !p-0">
      <div className="hidden md:grid md:grid-cols-[150px_1fr_120px_120px_110px_24px] gap-3 border-b border-border bg-secondary/60 px-5 py-2.5 text-[12px] font-medium text-muted-foreground">
        <span>Claim</span>
        <span>Patient · refused</span>
        <span className="text-right">At stake</span>
        <span>Deadline</span>
        <span>Resubmission</span>
        <span />
      </div>
      {rows === null && <SealLoader label="Loading refused claims" />}
      <div className="max-h-[680px] overflow-y-auto">
        {rows?.map((r) => (
          <Link key={r.claimId} href={`/billing/claims/${r.claimId}`} className="group grid w-full grid-cols-2 md:grid-cols-[150px_1fr_120px_120px_110px_24px] items-center gap-3 border-b border-border/70 px-5 py-3.5 text-left last:border-0 hover:bg-secondary/50">
            <span className="font-mono text-[12px]">
              {r.claimNo}
              {r.scenario && <span className="ml-1 rounded border border-border px-1 font-sans text-[10px] text-muted-foreground">{r.scenario}</span>}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-medium">{r.patientName}</span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {r.payerName} · {r.lines.map((x) => `${x.denialCode} on ${x.code}`).join(", ")}
              </span>
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums">{aed(r.amount)}</span>
            <span className={cn("text-[12px]", new Date(r.deadline).getTime() - Date.now() < 7 * 86_400_000 ? "font-medium text-risk-high" : "text-muted-foreground")}>{left(r.deadline)}</span>
            <span className="text-[12px] text-muted-foreground">{r.draft ? (r.draft.sentAt ? "sent" : "being prepared") : r.resubmissionsUsed ? `${r.resubmissionsUsed} of 2 used` : "—"}</span>
            <ArrowRight className="hidden size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground md:block" />
          </Link>
        ))}
        {rows && rows.length < total && (
          <button onClick={showMore} disabled={more} className="w-full px-5 py-3 text-[13px] text-muted-foreground hover:bg-secondary/50 hover:text-foreground">
            {more ? "Loading…" : `Show more · ${(total - rows.length).toLocaleString()} more`}
          </button>
        )}
        {rows?.length === 0 && <p className="px-5 py-10 text-center text-[14px] text-muted-foreground">No refused claims waiting. Everything has been won back or closed.</p>}
      </div>
    </div>
  );
}
