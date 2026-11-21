"use client";

import { SealLoader } from "@/components/brand/seal-loader";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, ExternalLink, Loader2, RotateCw, Send, ShieldCheck, X } from "lucide-react";
import { CONCEPT_TEXT } from "@/lib/rules/concepts";
import type { DocConcept } from "@/lib/rules/dsl";
import { RiskBar, RiskRing, StatusPill, aed, initials, riskBand, riskText } from "./risk";
import { motion } from "motion/react";
import ShinyText from "@/components/ShinyText";
import { FixPanel } from "./fix-panel";
import { TraceTerminal } from "./trace-terminal";
import { CodeChip } from "@/components/shared/code-chip";
import { cn } from "@/lib/utils";

// ── Shapes coming from /api/claims/[id] and the check stream ─────────────────
export type Hit = {
  ruleId: string;
  title: string;
  family: string;
  denialCode: string;
  severity: string;
  fired: true | "unknown";
  missing: DocConcept[];
  insurerNeeds: string;
  fixActions: string[];
  fixTemplates: string[];
  verified: boolean;
  source: { publisher: string; title: string; url: string };
};
export type RuleLine = { activityId: string; code: string; label: string; hits: Hit[] };
export type Similar = { claimId: string; score: number; codes: string[]; firstPassRefused: boolean; refused: string[]; fixes: string[]; hospital?: string; clinician?: string; value?: number };
export type DocAnswer = { ruleId: string; activityId: string; concept: DocConcept; documented: boolean; evidence: string };
export type Judge = {
  ms: number;
  error?: string;
  lines?: { activityId: string; probability: number; reasons: { text: string; ruleId?: string; pastClaimIds?: string[] }[] }[];
  documentation?: DocAnswer[];
  claimProbability?: number;
  confidence?: string;
  summary?: string;
  flags?: string[];
  model?: string;
  provider?: string;
  latencyMs?: number;
  fallbackUsed?: boolean;
};
export type Critic = { ms: number; error?: string; verdict?: string; agreement?: string; issues?: { check: string; activityId?: string; detail: string }[]; note?: string; model?: string; provider?: string; latencyMs?: number; fallbackUsed?: boolean };
export type Routed = { ms: number; route: "hold" | "ready"; riskScore: number; holdReasons: string[]; lineRisk: Record<string, number>; mode: string; agreement: string; lines?: { activityId: string; hits: Hit[] }[] };
export type HospitalStep = { ms: number; hospital: string; insurer: string; hospitalClaims: number; hospitalRate: number; regionalRate: number; factor: number; insurerFactor?: number; doctor?: { name: string; claims: number; rate: number; clinicRate: number; factor: number }; topCodes: { code: string; n: number; amount: number }[] };
export type CheckState = { run: number; hospital?: HospitalStep; rules?: { ms: number; lines: RuleLine[] }; retrieval?: { ms: number; similar: Similar[] }; judge?: Judge; critic?: Critic; routed?: Routed; error?: string };
export type Ev = { seq: number; type: string; at: string; run?: number; stage?: string; [k: string]: unknown };
export type Finding = { _id: string; activityId?: string; stage: string; kind?: string; ruleId?: string; denialCode?: string; insurerNeeds?: string; evidenceSpan?: string; reason?: string; pastClaimIds: string[]; gapConcepts?: DocConcept[]; probability?: number; severity: string };
export type Line = { activityId: string; code: string; label: string; quantity: number; net: number; priorAuthId?: string };
export type Detail = {
  claim: { _id: string; claimNo: string; status: string; net: number; gross: number; riskScore: number | null; liveCheckState: string; createdAt: string; scenario?: string; check?: { run: number; route?: string; mode?: string }; versions: { version: number; lines: Line[]; sentAt?: string; transactionId?: string }[] };
  patient: { name: string; maskedId: string; dob: string; sex: string };
  payer: { name: string };
  provider: { name: string; specialty: string };
  encounter: { complaint: string; findings: string; plan?: string; start: string; type: number; addenda?: { id: string; text: string; signedBy: string; signedAt: string }[] };
  questionSets: { _id: string; status: string; composedBy?: string; questions: { gapId: string; order?: string; textEn: string; fields: { key: string; labelEn: string; unit?: string; kind: string }[]; answer?: Record<string, string | number> }[]; resolution?: { gapId: string; resolved: boolean; note: string }[] }[];
  diagnoses: { icd10: string; description?: string; primary: boolean }[];
  findings: Finding[];
  remittances: { claimVersion: number; receivedAt: string; lines: { activityId: string; code: string; paymentAmount: number; denialCode?: string; payerComment?: string }[] }[];
  denials: { activityId: string; denialCode: string; amount: number; deadline: string; status: string }[];
  events: Ev[];
};

function reduce(s: CheckState, e: Ev): CheckState {
  if (e.type === "claim.check.started") return e.run! >= s.run ? { run: e.run! } : s;
  if (e.run !== s.run) return s;
  if (e.type === "claim.check.rule_result") return { ...s, rules: { ms: e.ms as number, lines: e.lines as RuleLine[] } };
  if (e.type !== "claim.check.ai_result") return s;
  if (e.stage === "retrieval") return { ...s, retrieval: { ms: e.ms as number, similar: e.similar as Similar[] } };
  if (e.stage === "judge") return { ...s, judge: e as unknown as Judge };
  if (e.stage === "critic") return { ...s, critic: e as unknown as Critic };
  if (e.stage === "routed") return { ...s, routed: e as unknown as Routed };
  if (e.stage === "hospital") return { ...s, hospital: e as unknown as HospitalStep };
  if (e.stage === "error") return { ...s, error: e.error as string };
  return s;
}

const fmt = (ms?: number) => (ms == null ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });

// ── Page ──────────────────────────────────────────────────────────────────────
export function ClaimDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [check, dispatch] = useReducer((s: CheckState, evs: Ev[]) => evs.reduce(reduce, s), { run: 0 });
  const [events, setEvents] = useState<Ev[]>([]);
  const [streamKey, setStreamKey] = useState(0);
  const lastSeq = useRef(0);

  const ingest = useCallback((evs: Ev[]) => {
    const fresh = evs.filter((e) => e.seq > lastSeq.current);
    if (!fresh.length) return;
    lastSeq.current = fresh.at(-1)!.seq;
    setEvents((xs) => [...xs, ...fresh]);
    dispatch(fresh);
  }, []);

  const load = useCallback(async () => {
    const r = await fetch(`/api/claims/${id}`).then((x) => x.json());
    if (r.error) return setNotFound(r.error);
    setDetail(r);
    ingest((r.events as { seq: number; type: string; at: string; payload: Record<string, unknown> }[]).map((e) => ({ seq: e.seq, type: e.type, at: e.at, ...e.payload })));
    return r as Detail;
  }, [id, ingest]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live check stream (SSE). Opens while a check is pending or running, and after "Re-run check".
  const state = detail?.claim.liveCheckState;
  const checkable = ["draft", "ready", "checking", "hold"].includes(detail?.claim.status ?? "");
  const wantsStream = (state === "idle" && checkable) || state === "rules" || state === "judge" || state === "critic" || streamKey > 0;
  useEffect(() => {
    if (!detail || !wantsStream) return;
    const es = new EventSource(`/api/claims/${id}/check?since=${lastSeq.current}`);
    const types = ["claim.check.started", "claim.check.rule_result", "claim.check.ai_result", "claim.held", "claim.created", "claim.submitted", "questions.created", "addendum.attached"];
    for (const t of types) es.addEventListener(t, (m) => ingest([{ ...(JSON.parse((m as MessageEvent).data) as Ev), type: t }]));
    es.addEventListener("end", () => {
      es.close();
      void load();
    });
    es.onerror = () => es.close();
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, streamKey, detail?.claim._id, wantsStream]);

  // Other people's actions on this claim (doctor answers, a re-check started elsewhere): poll events every 1.5 s.
  useEffect(() => {
    let stop = false;
    let cur = 0;
    const tick = async () => {
      try {
        const r = await fetch(`/api/events?since=${cur}`).then((x) => x.json());
        const mine = cur > 0 ? (r.events ?? []).filter((e: { payload?: { claimId?: string } }) => e.payload?.claimId === id) : [];
        cur = r.cursor ?? cur;
        if (mine.length) {
          const fresh = await load();
          if (fresh && ["rules", "judge", "critic"].includes(fresh.claim.liveCheckState)) setStreamKey((k) => k + 1);
        }
      } catch {}
      if (!stop) setTimeout(tick, 1500);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [id, load]);

  // Refresh claim + findings when routing lands.
  useEffect(() => {
    if (check.routed) void load();
  }, [check.routed, load]);

  // While with the insurer, collect the remittance (the post office adjudicates lazily on poll).
  const status = detail?.claim.status;
  useEffect(() => {
    if (status !== "submitted" && status !== "resubmitted") return;
    const t = setInterval(async () => {
      const r = await fetch("/api/remittances/poll", { method: "POST" }).then((x) => x.json()).catch(() => null);
      if (r?.received?.some((x: { claimId: string }) => x.claimId === id)) void load();
    }, 3000);
    return () => clearInterval(t);
  }, [status, id, load]);

  if (notFound) return <main className="mx-auto max-w-[1400px] px-4 md:px-6 py-24 text-center text-muted-foreground">{notFound}</main>;
  if (!detail) return <SealLoader className="min-h-[70vh]" size={44} label="Opening the claim" />;

  const c = detail.claim;
  const v = c.versions.at(-1)!;
  const running = ["rules", "judge", "critic"].includes(c.liveCheckState) || (check.run > 0 && !check.routed && !check.error && c.status === "checking");
  const lineRisk = check.routed?.lineRisk ?? Object.fromEntries((check.judge?.lines ?? []).map((l) => [l.activityId, l.probability]));
  const claimRisk = check.routed?.riskScore ?? (c.status !== "checking" ? c.riskScore : null);

  return (
    <main className="mx-auto max-w-[1400px] px-4 md:px-6 pb-24 pt-8">
      <Link href="/billing" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Claims
      </Link>

      {/* Hero: who, what, and the live check */}
      <section className="card relative mt-4 overflow-hidden !rounded-[36px] p-5 md:p-9 text-ink">
        <div className="pointer-events-none absolute -left-24 -top-32 size-[420px] rounded-full bg-seal-mint/50 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 right-10 size-[380px] rounded-full bg-[#f4e6cf]/60 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
          <div className="flex items-center gap-4 sm:gap-5">
            <span className="flex size-14 shrink-0 sm:size-20 items-center justify-center rounded-full bg-white/70 text-[26px] font-semibold ring-1 ring-ink/15">{initials(detail.patient.name)}</span>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="display text-[30px] md:text-[44px] leading-tight">{detail.patient.name}</h1>
                <StatusPill status={c.status} className="!bg-white/70 !text-ink" />
              </div>
              <p className="mt-1 text-[16px] text-ink/60">
                {detail.provider.name} · {detail.payer.name} · {when(detail.encounter.start)}
              </p>
              <p className="mt-1 font-mono text-[13px] text-ink/35">{c.claimNo}</p>
            </div>
          </div>
          <div className="flex items-center gap-6 lg:gap-8">
            <div className="text-right">
              <div className="text-[14px] text-ink/50">Claim value</div>
              <div className="dot whitespace-nowrap text-[30px] text-seal-deep sm:text-[42px]">{aed(c.net)}</div>
            </div>
            <div className="rounded-full bg-white p-1.5">
              <RiskRing p={running && !check.routed ? null : claimRisk} size={150} />
            </div>
          </div>
        </div>
        <Pipeline check={check} running={running} />
      </section>

      <TraceTerminal detail={detail} check={check} running={running} events={events} />

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 lg:gap-8">
        <div className="min-w-0 space-y-8">
          {["hold", "ready"].includes(c.status) && check.routed && <FixPanel claimId={c._id} run={check.run} onApplied={() => setStreamKey((k) => k + 1)} />}
          <Lines lines={v.lines} rules={(check.routed?.lines as RuleLine[] | undefined) ?? check.rules?.lines} risk={lineRisk} remittance={detail.remittances.at(-1)} />
          <Findings detail={detail} check={check} />
          <DoctorQuestions detail={detail} />
          <Note detail={detail} quotes={(check.judge?.documentation ?? []).filter((a) => a.documented && a.evidence).map((a) => a.evidence)} />
        </div>

        <aside className="space-y-5">
          {check.judge?.summary && (
            <div className="card p-6">
              <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">SEAL&apos;s view</div>
              <p className="mt-2 text-[17px] leading-relaxed">{check.judge.summary}</p>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
                {check.routed?.agreement === "agree" && <Chip tone="good">Second opinion agrees</Chip>}
                {check.routed?.agreement === "low_agreement" && <Chip tone="warn">Second opinion disagrees — please review</Chip>}
              </div>
            </div>
          )}
          <Actions detail={detail} running={running} onChanged={load} onRecheck={() => setStreamKey((k) => k + 1)} />
          <SimilarClaims similar={check.retrieval?.similar} />
          <details className="group card overflow-hidden !p-0">
            <summary className="cursor-pointer list-none px-4 md:px-6 py-4 text-[14px] font-semibold text-muted-foreground group-open:text-foreground">Technical details</summary>
            <div className="space-y-4 border-t border-black/[0.05] p-4">
              <Xml id={c._id} version={v.version} />
              <Timeline events={events} />
            </div>
          </details>
        </aside>
      </div>
    </main>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "good" | "warn" }) {
  return <span className={cn("rounded-full px-2 py-0.5", tone === "good" ? "bg-risk-low/10 text-risk-low" : tone === "warn" ? "bg-risk-mid/10 text-risk-mid" : "bg-secondary text-muted-foreground")}>{children}</span>;
}

function Card({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[20px] font-semibold">{title}</h2>
        {aside && <div className="text-[13px] text-muted-foreground">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

// ── Live check pipeline ───────────────────────────────────────────────────────
function Pipeline({ check, running }: { check: CheckState; running: boolean }) {
  const hits = check.rules?.lines.reduce((n, l) => n + l.hits.length, 0) ?? 0;
  const steps = [
    { key: "rules", label: "Insurer rules", done: !!check.rules, ms: check.rules?.ms, detail: check.rules ? (hits ? `${hits} rule${hits > 1 ? "s" : ""} to look at` : "Nothing broken") : "Approvals, limits, duplicates" },
    { key: "retrieval", label: "Past claims", done: !!check.retrieval, ms: check.retrieval?.ms, detail: check.retrieval ? `${check.retrieval.similar.length} similar claims found` : "What happened before" },
    { key: "judge", label: "AI review", done: !!check.judge, failed: !!check.judge?.error, ms: check.judge?.ms, detail: check.judge ? (check.judge.error ? "Paused, rules applied" : "Read the note and the rules") : "Reads the doctor's note" },
    { key: "critic", label: "Second opinion", done: !!check.critic, failed: !!check.critic?.error || check.critic?.verdict === "fail", ms: check.critic?.ms, detail: check.critic ? (check.critic.error ? "Unavailable" : check.critic.verdict === "pass" && check.critic.agreement === "agree" ? "Agrees" : "Asks for a review") : "A second AI double-checks" },
  ];
  const firstPending = steps.findIndex((s) => !s.done);
  return (
    <div className="relative mt-9">
      <div className="mb-4 flex items-center justify-between text-[14px]">
        {running && !check.routed ? <ShinyText text="SEAL is checking this claim…" color="#5f6f6b" shineColor="#1f2b29" speed={1.5} className="text-[16px] font-medium" /> : <span className="text-[16px] font-medium text-ink/70">{check.routed ? `Checked in ${fmt(check.routed.ms)}` : "Not checked yet"}</span>}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map((s, i) => {
          const active = running && i === firstPending;
          return (
            <motion.div key={s.key} initial={false} animate={{ opacity: s.done || active ? 1 : 0.45 }} className={cn("rounded-2xl p-4 ring-1 transition-colors", s.done ? (s.failed ? "bg-seal-amber/10 ring-seal-amber/30" : "bg-white/60 ring-ink/10") : active ? "bg-white/60 ring-seal-deep/40" : "ring-ink/10")}>
              <div className="flex items-center gap-2.5">
                <span className={cn("flex size-6 items-center justify-center rounded-full", s.done ? (s.failed ? "bg-amber-400 text-black" : "bg-seal-green text-black") : "ring-1 ring-ink/25")}>
                  {s.done ? s.failed ? <X className="size-3.5" /> : <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin text-seal-deep" /> : null}
                </span>
                <span className="text-[16px] font-semibold">{s.label}</span>
                <span className="ml-auto font-mono text-[12px] text-ink/40 tabular-nums">{fmt(s.ms)}</span>
              </div>
              <p className="mt-2 text-[13px] text-ink/55">{s.detail}</p>
            </motion.div>
          );
        })}
      </div>
      {check.error && <p className="mt-4 rounded-2xl bg-risk-high/20 px-5 py-3 text-[14px]">The check could not finish, so the claim is held for a person.</p>}
      {check.routed && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("mt-4 rounded-2xl px-4 md:px-6 py-5", check.routed.route === "hold" ? "bg-[#c2473c]/10" : "bg-seal-green/15")}>
          <div className={cn("text-[24px] font-bold", check.routed.route === "hold" ? "text-[#b23b31]" : "text-seal-deep")}>{check.routed.route === "hold" ? "Held before sending" : "Ready to send"}</div>
          {check.routed.holdReasons.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-[16px] text-ink/85">
              {check.routed.holdReasons.map((r) => (
                <li key={r} className="flex gap-2.5">
                  <span className="mt-[10px] size-1.5 shrink-0 rounded-full bg-white/60" />
                  {r.startsWith("Low agreement") ? "The second opinion asked for a person to review SEAL's reasoning" : r.replace(/\s*\([A-Z0-9-]+\)\s*$/, "").replace(/^(Fix needed|Documentation gap): /, "").replace(" — ", ": ")}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[16px] text-ink/70">No rule is broken and SEAL expects it to be paid.</p>
          )}
        </motion.div>
      )}
    </div>
  );
}

// ── Lines ─────────────────────────────────────────────────────────────────────
function Lines({ lines, rules, risk, remittance }: { lines: Line[]; rules?: RuleLine[]; risk: Record<string, number>; remittance?: Detail["remittances"][number] }) {
  return (
    <Card title="Lines" aside={`${lines.length} activities`}>
      <div className="card overflow-hidden !p-0">
        {lines.map((l) => {
          const hits = rules?.find((r) => r.activityId === l.activityId)?.hits ?? [];
          const paid = remittance?.lines.find((x) => x.activityId === l.activityId);
          return (
            <div key={l.activityId} className="grid grid-cols-2 md:grid-cols-[64px_1fr_120px_180px] items-center gap-4 border-b border-border/70 px-5 py-3.5 last:border-0">
              <span><CodeChip code={l.code} /></span>
              <div className="min-w-0">
                <div className="text-[14px] font-medium">
                  {l.label}
                  {l.quantity > 1 && <span className="ml-1.5 text-muted-foreground">× {l.quantity}</span>}
                  {l.priorAuthId && <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{l.priorAuthId}</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {hits.map((h) => (
                    <CodeChip key={h.ruleId} code={h.denialCode} className="text-[11px]" />
                  ))}
                  {paid && (
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px]", paid.denialCode ? "bg-risk-high/10 text-risk-high" : "bg-risk-low/10 text-risk-low")}>
                      {paid.denialCode ? `Refused ${paid.denialCode}` : "Paid"}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-right font-mono text-[13px] tabular-nums">{aed(l.net)}</span>
              <RiskBar p={risk[l.activityId] ?? null} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Findings ──────────────────────────────────────────────────────────────────
const KIND: Record<string, { label: string; cls: string }> = {
  documentation: { label: "Documentation gap · doctor", cls: "bg-risk-mid/10 text-risk-mid" },
  fix: { label: "Fix · billing or coding", cls: "bg-risk-high/10 text-risk-high" },
  risk: { label: "AI judge", cls: "bg-secondary text-foreground" },
  agreement: { label: "Critic", cls: "bg-secondary text-foreground" },
};

function Findings({ detail, check }: { detail: Detail; check: CheckState }) {
  const lines = detail.claim.versions.at(-1)!.lines;
  const hitsById = new Map([...(check.rules?.lines ?? []), ...((check.routed?.lines as RuleLine[] | undefined) ?? [])].flatMap((l) => l.hits.map((h) => [`${l.activityId}|${h.ruleId}`, h] as const)));
  const actionable = detail.findings.filter((f) => f.stage === "rule_engine");
  const judged = detail.findings.filter((f) => f.stage === "claim_judge");
  const critic = detail.findings.filter((f) => f.stage === "critic");
  if (!check.routed && !detail.findings.length) return null;
  return (
    <Card title="Findings" aside={actionable.length ? `${actionable.length} to resolve before sending` : "Nothing to resolve"}>
      <div className="space-y-3">
        {actionable.map((f) => {
          const h = hitsById.get(`${f.activityId}|${f.ruleId}`);
          const line = lines.find((l) => l.activityId === f.activityId);
          const k = KIND[f.kind ?? "fix"];
          return (
            <article key={f._id} className="card p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-medium", k.cls)}>{k.label}</span>
                <span className="text-[13px] text-muted-foreground">
                  {line?.code} {line?.label}
                </span>
                {f.probability != null && <span className={cn("ml-auto font-mono text-[13px]", riskText[riskBand(f.probability)])}>{Math.round(f.probability * 100)}%</span>}
              </div>
              <h3 className="mt-2.5 text-[16px] font-semibold">{h?.title ?? f.reason}</h3>
              <p className="mt-0.5 font-mono text-[12px] text-muted-foreground">
                {f.ruleId} · would be refused {f.denialCode}
              </p>
              {f.insurerNeeds && (
                <p className="mt-3 text-[14px] leading-relaxed">
                  <span className="font-medium">The insurer needs: </span>
                  {f.insurerNeeds}
                </p>
              )}
              {f.kind === "fix" && f.reason && h && <p className="mt-2 text-[13px] text-muted-foreground">{f.reason}</p>}
              {f.evidenceSpan && (
                <blockquote className="mt-3 border-l-2 border-seal-green pl-3 text-[13px] italic text-muted-foreground">“{f.evidenceSpan}”</blockquote>
              )}
              {f.gapConcepts && f.gapConcepts.length > 0 && (
                <div className="mt-3 rounded-xl bg-secondary px-4 py-3 text-[13px]">
                  <div className="font-medium">Not found in the note</div>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {f.gapConcepts.map((cpt) => (
                      <li key={cpt}>— {CONCEPT_TEXT[cpt]}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[12px]">The doctor will be asked to add this in their own words (phase 6). SEAL never writes it for them.</p>
                </div>
              )}
              {h && h.fixTemplates.length > 0 && f.kind === "documentation" && (
                <div className="mt-3 space-y-1">
                  {h.fixTemplates.map((t) => (
                    <p key={t} className="rounded-lg bg-background px-3 py-1.5 font-mono text-[12px] ring-1 ring-border">
                      {t}
                    </p>
                  ))}
                </div>
              )}
              {h && (
                <a href={h.source.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground">
                  {h.verified ? <ShieldCheck className="size-3.5 text-risk-low" /> : null}
                  {h.source.publisher}: {h.source.title} <ExternalLink className="size-3" />
                </a>
              )}
            </article>
          );
        })}

        {judged.length > 0 && (
          <div className="rounded-2xl bg-secondary p-5">
            <div className="text-[13px] font-medium">Why — AI judge, every reason cited</div>
            <ul className="mt-3 space-y-2.5">
              {judged.map((f) => (
                <li key={f._id} className="text-[13px] leading-relaxed">
                  <span className="mr-2 font-mono text-[12px] text-muted-foreground">{lines.find((l) => l.activityId === f.activityId)?.code}</span>
                  {f.reason}
                  <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                    {f.ruleId && <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-border">{f.ruleId}</span>}
                    {f.pastClaimIds.map((p) => (
                      <Link key={p} href={`/billing/claims/${p}`} className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-border hover:bg-foreground hover:text-background">
                        {p}
                      </Link>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            {check.judge?.flags && check.judge.flags.length > 0 && <p className="mt-3 text-[12px] text-muted-foreground">Guardrails applied: {check.judge.flags.join(", ").replace(/_/g, " ")}.</p>}
          </div>
        )}

        {critic.length > 0 && (
          <div className="rounded-2xl border border-risk-mid/40 p-5">
            <div className="text-[13px] font-medium text-risk-mid">Critic objections — a person should review</div>
            <ul className="mt-2 space-y-1 text-[13px]">
              {critic.map((f) => (
                <li key={f._id}>{f.reason}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Doctor questions and the signed addendum (stage 4) ────────────────────────
function DoctorQuestions({ detail }: { detail: Detail }) {
  const sets = detail.questionSets ?? [];
  if (!sets.length) return null;
  const s = sets[0];
  return (
    <Card title="Questions to the doctor" aside={s.status === "open" ? `Waiting for ${s.questions.length} answer${s.questions.length === 1 ? "" : "s"} on /doctor` : "Answered and signed"}>
      <div className="space-y-3 card p-6">
        {s.questions.map((q, i) => {
          const res = s.resolution?.find((r) => r.gapId === q.gapId);
          return (
            <div key={q.gapId} className="text-[13px]">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[12px] text-muted-foreground">Q{i + 1}</span>
                <span className="font-medium">{q.textEn}</span>
                {s.status === "open" ? (
                  <span className="ml-auto shrink-0 rounded-full bg-risk-mid/10 px-2 py-0.5 text-[11px] text-risk-mid">open</span>
                ) : res ? (
                  <span className={cn("ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px]", res.resolved ? "bg-risk-low/10 text-risk-low" : "bg-risk-mid/10 text-risk-mid")}>{res.resolved ? "resolves the gap" : "may not resolve it"}</span>
                ) : null}
              </div>
              {q.answer && Object.keys(q.answer).length > 0 && (
                <p className="mt-1 pl-7 text-muted-foreground">
                  {q.fields.map((f) => `${f.labelEn.replace(/[?:.]+$/, "")}: ${q.answer?.[f.key] ?? "—"}${f.unit && f.kind === "number" ? f.unit : ""}`).join(" · ")}
                </p>
              )}
              {res && !res.resolved && <p className="mt-1 pl-7 text-[12px] text-risk-mid">{res.note}</p>}
            </div>
          );
        })}
        {(detail.encounter.addenda ?? []).map((a) => (
          <pre key={a.id} className="whitespace-pre-wrap rounded-xl bg-secondary p-4 font-sans text-[13px] leading-relaxed">
            {a.text}
          </pre>
        ))}
        <p className="text-[11px] text-muted-foreground">Questions {s.composedBy === "agent" ? "worded by the question composer" : "from SEAL's templates"}; answers are the doctor&apos;s own words, attached verbatim.</p>
      </div>
    </Card>
  );
}

// ── Note with the judge's evidence highlighted ───────────────────────────────
function highlight(text: string, quotes: string[]) {
  const spans: [number, number][] = [];
  const low = text.toLowerCase();
  for (const q of quotes) {
    for (const part of q.split(/\.\.\.|…/)) {
      const p = part.trim().replace(/[.;,]+$/, "");
      if (p.length < 4) continue;
      const i = low.indexOf(p.toLowerCase());
      if (i >= 0) spans.push([i, i + p.length]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const [s, e] of spans) {
    if (s < at) continue;
    out.push(text.slice(at, s), <mark key={s} className="rounded bg-seal-green/25 px-0.5 text-foreground">{text.slice(s, e)}</mark>);
    at = e;
  }
  out.push(text.slice(at));
  return out;
}

function Note({ detail, quotes }: { detail: Detail; quotes: string[] }) {
  const e = detail.encounter;
  const parts = [
    ["Complaint, as told", e.complaint],
    ["Findings", e.findings],
    ["Plan", e.plan],
  ].filter(([, t]) => t) as [string, string][];
  return (
    <Card title="Doctor's note" aside={quotes.length ? "Highlighted: words the AI judge relied on" : "Read-only from the EMR"}>
      <div className="card p-6">
        <dl className="space-y-3.5">
          {parts.map(([k, t]) => (
            <div key={k}>
              <dt className="text-[12px] font-medium text-muted-foreground">{k}</dt>
              <dd className="mt-0.5 text-[14px] leading-relaxed">{highlight(t, quotes)}</dd>
            </div>
          ))}
          <div>
            <dt className="text-[12px] font-medium text-muted-foreground">Diagnoses (doctor / coder)</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {detail.diagnoses.map((x) => (
                <span key={x.icd10} className="inline-flex items-center gap-1.5 text-[12px]">
                  <CodeChip code={x.icd10} /> {x.description}
                  {x.primary ? " · main" : ""}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}

// ── Side panels ───────────────────────────────────────────────────────────────
function Actions({ detail, running, onChanged, onRecheck }: { detail: Detail; running: boolean; onChanged: () => void; onRecheck: () => void }) {
  const c = detail.claim;
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const post = async (what: string, url: string, body?: unknown) => {
    setBusy(what);
    setErr(null);
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-seal-user": "noura-al-mansoori" }, body: body ? JSON.stringify(body) : undefined }).then((x) => x.json());
    setBusy(null);
    if (r.error) setErr(r.error);
    return r;
  };
  const submit = async (override?: string) => {
    await post("submit", `/api/claims/${c._id}/submit`, override ? { overrideReason: override } : {});
    onChanged();
  };
  const recheck = async () => {
    await post("recheck", `/api/claims/${c._id}/check`);
    onRecheck();
    setTimeout(onChanged, 300);
  };
  const sent = c.versions.at(-1)!.sentAt;
  return (
    <div className="card p-6">
      <div className="text-[13px] font-medium">Actions</div>
      {err && <p className="mt-2 rounded-lg bg-risk-high/10 px-3 py-2 text-[12px] text-risk-high">{err}</p>}
      <div className="mt-3 space-y-2">
        {c.status === "ready" && (
          <button onClick={() => submit()} disabled={!!busy} className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-2.5 text-[14px] font-medium text-background disabled:opacity-50">
            {busy === "submit" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Submit to {detail.payer.name}
          </button>
        )}
        {c.status === "hold" && (
          <>
            <p className="text-[12px] leading-relaxed text-muted-foreground">Held claims go once the fixes are made and the check re-run, or with a written override.</p>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Override reason (recorded)" rows={2} className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-foreground" />
            <button onClick={() => submit(reason)} disabled={!!busy || reason.trim().length < 3} className="flex w-full items-center justify-center gap-2 rounded-full border border-foreground py-2 text-[13px] font-medium disabled:opacity-40">
              {busy === "submit" && <Loader2 className="size-3.5 animate-spin" />} Release with override
            </button>
          </>
        )}
        {["ready", "hold"].includes(c.status) && (
          <button onClick={recheck} disabled={!!busy || running} className="flex w-full items-center justify-center gap-2 rounded-full bg-secondary py-2 text-[13px] font-medium disabled:opacity-40">
            {busy === "recheck" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />} Re-run check
          </button>
        )}
        {(c.status === "submitted" || c.status === "resubmitted") && (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Sent {sent ? when(sent) : ""}. Waiting for the remittance…
          </p>
        )}
        {["paid", "partially_paid", "refused"].includes(c.status) && detail.remittances.length > 0 && (
          <div className="text-[13px]">
            <p className="text-muted-foreground">Remittance received {when(detail.remittances.at(-1)!.receivedAt)}.</p>
            {detail.denials.filter((d) => d.status === "queued").map((d) => (
              <p key={d.activityId} className="mt-1">
                Line {d.activityId}: refused <span className="font-mono">{d.denialCode}</span> · {aed(d.amount)} · resubmit by {new Date(d.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </p>
            ))}
          </div>
        )}
        {running && <p className="flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Checking…</p>}
      </div>
    </div>
  );
}

function SimilarClaims({ similar }: { similar?: Similar[] }) {
  if (!similar) return null;
  return (
    <div className="card p-6">
      <div className="text-[13px] font-medium">Similar past claims</div>
      <p className="text-[12px] text-muted-foreground">Same insurer, nearest by meaning. The judge cites these.</p>
      <ul className="mt-3 space-y-2">
        {similar.slice(0, 8).map((s) => (
          <li key={s.claimId} className="flex items-start gap-2 text-[12px]">
            <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", s.firstPassRefused ? "bg-risk-high" : "bg-risk-low")} />
            <div className="min-w-0">
              {s.hospital ? (
                <span>
                  <span className="mr-1 rounded-full bg-seal-mint/60 px-1.5 py-0.5 text-[9.5px] font-medium tracking-[0.08em] text-[#237a4b]">{s.hospital.toUpperCase()}</span>
                  <span>{s.clinician} · AED {Math.round(s.value ?? 0)}</span>
                </span>
              ) : (
                <Link href={`/billing/claims/${s.claimId}`} className="font-mono hover:underline">
                  {s.claimId}
                </Link>
              )}{" "}
              <span className="text-muted-foreground">{Math.round(s.score * 100)}% similar</span>
              <div className="truncate text-muted-foreground">{s.firstPassRefused ? `Refused: ${s.refused.join("; ")}` : "Paid first time"}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Xml({ id, version }: { id: string; version: number }) {
  const [xml, setXml] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && xml === null) fetch(`/api/claims/${id}/xml?version=${version}`).then((r) => r.text()).then(setXml);
  }, [open, xml, id, version]);
  return (
    <div className="rounded-2xl border border-border">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-5 py-4 text-[13px] font-medium">
        eClaimLink XML · version {version}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && <pre className="max-h-[420px] overflow-auto border-t border-border px-5 py-4 font-mono text-[11px] leading-relaxed text-muted-foreground">{xml ?? "Loading…"}</pre>}
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  "claim.created": "Claim built",
  "claim.check.started": "Check started",
  "claim.check.rule_result": "Rule results",
  "claim.held": "Held",
  "claim.released": "Released",
  "claim.submitted": "Sent to post office",
  "resubmission.sent": "Resubmission sent",
  "remittance.received": "Remittance received",
  "denial.queued": "Refused line queued",
  "questions.created": "Questions sent to doctor",
  "question.answered": "Answer saved",
  "addendum.attached": "Addendum attached",
};

function Timeline({ events }: { events: Ev[] }) {
  const shown = useMemo(() => events.filter((e) => e.type !== "claim.check.ai_result" || ["judge", "critic", "routed"].includes(e.stage ?? "")).slice(-14), [events]);
  return (
    <div className="card p-6">
      <div className="text-[13px] font-medium">Event timeline</div>
      <ol className="mt-3 space-y-2">
        {shown.map((e) => (
          <Fragment key={e.seq}>
            <li className="flex items-baseline gap-3 text-[12px]">
              <span className="w-12 shrink-0 font-mono text-muted-foreground tabular-nums">#{e.seq}</span>
              <span className="flex-1">{EVENT_LABEL[e.type] ?? (e.stage === "routed" ? "Routed" : e.stage === "judge" ? "AI judgement" : e.stage === "critic" ? "Critic verdict" : e.type)}</span>
              <span className="font-mono text-muted-foreground">{new Date(e.at).toLocaleTimeString("en-GB", { timeZone: "Asia/Dubai" })}</span>
            </li>
          </Fragment>
        ))}
      </ol>
    </div>
  );
}
