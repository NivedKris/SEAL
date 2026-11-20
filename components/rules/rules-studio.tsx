"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, FlaskConical, Loader2, Play, ShieldCheck, X } from "lucide-react";
import { describe } from "@/lib/rules/describe";
import type { Rule } from "@/lib/rules/dsl";
import { cn } from "@/lib/utils";

type RuleRow = { _id: string; payerId: string; dsl: Rule; verified: boolean; version: number; author: string; approvedBy: string | null; active: boolean };
type Proposal = { _id: string; clusterId: string; dsl: Rule; status: string; payerId?: string; codes?: string[]; denialCode?: string; windowDays?: number; backtest?: { caught: number; refusedInCluster: number; firedOnPaid: number; paidChecked: number }; rationale?: string; exampleClaimIds: string[]; decidedBy?: string };
type TestResult = { claimsChecked: number; refusedLines: number; fires: number; mightFire: number; caught: number; caughtSameCode: number; firedOnPaid: number };
type Step = { step: string; detail: Record<string, unknown> };

export function RulesStudio() {
  const [data, setData] = useState<{ rules: RuleRow[]; proposals: Proposal[]; lastCycle: { at: string } | null } | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult | "running">>({});
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const load = useCallback(async () => setData(await fetch("/api/rules").then((r) => r.json())), []);
  useEffect(() => {
    void load();
  }, [load]);

  const test = async (id: string, proposal = false) => {
    setTests((t) => ({ ...t, [id]: "running" }));
    const r = await fetch(`/api/rules/${id}/test${proposal ? "?proposal=1" : ""}`, { method: "POST" }).then((x) => x.json());
    setTests((t) => ({ ...t, [id]: r.result }));
  };
  const decide = async (id: string, decision: "approved" | "rejected") => {
    setBusy(id);
    await fetch(`/api/rules/proposals/${id}`, { method: "POST", headers: { "content-type": "application/json", "x-seal-user": "rania-fakhoury" }, body: JSON.stringify({ decision }) });
    setBusy(null);
    void load();
  };
  const cycle = async () => {
    setSteps([]);
    setBusy("cycle");
    const res = await fetch("/api/learning/run", { method: "POST" });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) setSteps((s) => [...(s ?? []), JSON.parse(l)]);
    }
    setBusy(null);
    void load();
  };

  const rules = (data?.rules ?? []).filter((r) => !filter || `${r._id} ${r.dsl.title} ${r.dsl.target.codes.join(" ")}`.toLowerCase().includes(filter.toLowerCase()));
  const open = data?.proposals.filter((p) => p.status === "proposed") ?? [];
  const decided = data?.proposals.filter((p) => p.status !== "proposed") ?? [];

  return (
    <main className="mx-auto max-w-[1400px] px-4 md:px-6 pb-24 pt-12">
      <p className="text-[13px] font-medium text-muted-foreground">Rania Fakhoury · Coding specialist</p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="display mt-1 text-[34px] md:text-[44px] lg:text-[52px] leading-tight">Insurer rules</h1>
        <button onClick={cycle} disabled={busy === "cycle"} className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-[14px] font-medium text-background disabled:opacity-50">
          {busy === "cycle" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run learning cycle
        </button>
      </div>
      <p className="mt-1 text-[14px] text-muted-foreground">
        {data?.rules.length ?? "…"} rules in the library · last learning cycle {data?.lastCycle ? new Date(data.lastCycle.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dubai" }) : "never"}
      </p>

      {steps && <CycleLog steps={steps} running={busy === "cycle"} />}

      <section className="mt-10">
        <h2 className="text-2xl font-semibold">Proposals from the rule miner</h2>
        <p className="mt-1 text-[14px] text-muted-foreground">Patterns found in recent refusals that no rule explains. Nothing goes live until a person approves it.</p>
        <div className="mt-4 space-y-3">
          {open.length === 0 && <p className="rounded-2xl bg-secondary px-5 py-6 text-[14px] text-muted-foreground">No open proposals. Run a learning cycle to look for new patterns.</p>}
          {open.map((p) => (
            <article key={p._id} className="card p-6">
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="rounded-full bg-risk-mid/10 px-2.5 py-0.5 font-medium text-risk-mid">Proposed · unverified</span>
                <span className="font-mono text-muted-foreground">{p.dsl.id}</span>
              </div>
              <h3 className="mt-2 text-[18px] font-semibold">{p.dsl.title}</h3>
              <p className="mt-1 text-[14px]">
                Flags <span className="font-mono">{p.dsl.target.codes.join(", ")}</span> for <span className="font-medium">{p.payerId}</span> when {describe(p.dsl.when)} → would be refused <span className="font-mono">{p.dsl.denialCode}</span>.
              </p>
              {p.backtest && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-[13px]">
                  <Stat label={`Refusals caught (last ${p.windowDays} days)`} value={`${p.backtest.caught} of ${p.backtest.refusedInCluster}`} />
                  <Stat label="Paid claims it would also flag" value={`${p.backtest.firedOnPaid} of ${p.backtest.paidChecked}`} />
                  <Stat label="Example claims" value={p.exampleClaimIds.slice(0, 3).join(", ")} mono />
                </div>
              )}
              {p.rationale && <p className="mt-3 text-[13px] text-muted-foreground">{p.rationale}</p>}
              <TestLine r={tests[p._id]} />
              <div className="mt-4 flex gap-2">
                <button onClick={() => decide(p._id, "approved")} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-[13px] font-medium text-background">
                  {busy === p._id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve
                </button>
                <button onClick={() => decide(p._id, "rejected")} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-[13px] font-medium">
                  <X className="size-3.5" /> Reject
                </button>
                <button onClick={() => test(p._id, true)} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-4 py-1.5 text-[13px] font-medium">
                  <FlaskConical className="size-3.5" /> Test against 12 months of history
                </button>
              </div>
            </article>
          ))}
          {decided.slice(0, 5).map((p) => (
            <div key={p._id} className="flex items-center gap-3 rounded-xl bg-secondary px-4 py-2.5 text-[13px]">
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", p.status === "approved" ? "bg-risk-low/10 text-risk-low" : "bg-background text-muted-foreground")}>{p.status}</span>
              <span className="font-mono text-[12px]">{p.dsl.id}</span> {p.dsl.title}
              <span className="ml-auto text-muted-foreground">{p.decidedBy}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold">Rule library</h2>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by id, title or code" className="w-72 rounded-full border border-border px-4 py-1.5 text-[13px] outline-none focus:border-foreground" />
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          {rules.map((r) => (
            <div key={r._id} className="border-b border-border/70 px-5 py-4 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px]">{r._id}</span>
                {r.verified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-risk-low/10 px-2 py-0.5 text-[11px] text-risk-low">
                    <ShieldCheck className="size-3" /> verified source
                  </span>
                ) : (
                  <span className="rounded-full bg-risk-mid/10 px-2 py-0.5 text-[11px] text-risk-mid">unverified</span>
                )}
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px]">v{r.version}</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[11px]">{r.dsl.denialCode}</span>
                {r.author === "rule-miner" && <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] text-background">learned · approved by {r.approvedBy}</span>}
                <button onClick={() => test(r._id)} className="ml-auto inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-[12px]">
                  {tests[r._id] === "running" ? <Loader2 className="size-3 animate-spin" /> : <FlaskConical className="size-3" />} Test this rule
                </button>
              </div>
              <div className="mt-1.5 text-[15px] font-medium">{r.dsl.title}</div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                <span className="font-mono">{r.dsl.target.codes.join(", ")}</span> · {r.dsl.payers === "*" ? "all insurers" : r.dsl.payers.join(", ")} · when {describe(r.dsl.when)}
              </p>
              <a href={r.dsl.source.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
                {r.dsl.source.publisher}: {r.dsl.source.title} <ExternalLink className="size-3" />
              </a>
              <TestLine r={tests[r._id]} />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-secondary px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-[15px] font-semibold", mono && "truncate font-mono text-[12px] font-normal")}>{value}</div>
    </div>
  );
}

function TestLine({ r }: { r?: TestResult | "running" }) {
  if (!r) return null;
  if (r === "running") return <p className="mt-2 flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Testing against history…</p>;
  return (
    <p className="mt-2 rounded-lg bg-secondary px-3 py-2 text-[12px]">
      On {r.claimsChecked.toLocaleString()} past claims with these services: fires on {r.fires} lines{r.mightFire ? ` (+${r.mightFire} depending on the note)` : ""}; would have caught <span className="font-semibold">{r.caught}</span> of {r.refusedLines} refused lines ({r.caughtSameCode} with the same denial code); would also have flagged {r.firedOnPaid} lines the insurer paid.
    </p>
  );
}

function CycleLog({ steps, running }: { steps: Step[]; running: boolean }) {
  const label: Record<string, string> = { outcomes: "Outcomes counted", clusters: "Refusal clusters", proposal: "Rule proposed", proposal_failed: "Proposal failed", evaluation: "Evaluation set re-run", done: "Cycle complete", error: "Error" };
  const ev = steps.find((s) => s.step === "evaluation")?.detail as { before?: Record<string, number> | null; after?: Record<string, number> } | undefined;
  return (
    <div className="mt-6 card p-6">
      <div className="text-[13px] font-medium">Learning cycle {running && <Loader2 className="ml-1 inline size-3.5 animate-spin" />}</div>
      <ol className="mt-2 space-y-1.5 text-[13px]">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-44 shrink-0 font-medium">{label[s.step] ?? s.step}</span>
            <span className="text-muted-foreground">
              {s.step === "outcomes" && `${s.detail.newOutcomes} new of ${s.detail.totalOutcomes} in the ledger`}
              {s.step === "clusters" && `${s.detail.found} unexplained (≥ ${s.detail.threshold} refusals in ${s.detail.windowDays} days)`}
              {s.step === "proposal" && `${s.detail.ruleId}: ${s.detail.title}`}
              {(s.step === "proposal_failed" || s.step === "error") && String(s.detail.error)}
              {s.step === "evaluation" && "300 held-out claims re-scored"}
            </span>
          </li>
        ))}
      </ol>
      {ev?.after && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 text-[13px]">
          {[
            ["Hold precision", "precision"],
            ["Refusal recall", "recall"],
            ["AUC", "auc"],
            ["First pass, baseline", "firstPassBaseline"],
            ["First pass, with SEAL", "firstPassWithSeal"],
          ].map(([l, k]) => (
            <div key={k} className="rounded-xl bg-secondary px-3 py-2.5">
              <div className="text-[11px] text-muted-foreground">{l}</div>
              <div className="mt-0.5 text-[17px] font-semibold tabular-nums">
                {ev.before ? <span className="text-[13px] font-normal text-muted-foreground">{fmt(ev.before[k])} → </span> : null}
                {fmt(ev.after?.[k])}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
const fmt = (x?: number) => (x == null ? "—" : `${Math.round(x * 1000) / 10}%`);
