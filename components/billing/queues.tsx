"use client";

import { SealLoader } from "@/components/brand/seal-loader";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, CheckCircle2, Hand, ShieldCheck } from "lucide-react";
import Stack from "@/components/Stack";
import { RiskBar, StatusPill, aed, riskBand, riskText } from "./risk";
import { RecoveryQueue } from "./recovery";
import { cn } from "@/lib/utils";

type Row = {
  _id: string;
  claimNo: string;
  status: string;
  net: number;
  riskScore: number | null;
  createdAt: string;
  patientName?: string;
  payerName?: string;
  providerName?: string;
  scenario?: string;
  check?: { holdReasons?: string[]; route?: string };
  readyAt?: string;
  sentAt?: string;
  paidAmount?: number;
  paidAt?: string;
  versions: { version: number; lines: { code: string; label?: string }[] }[];
};

const TABS = [
  { key: "hold", label: "Needs attention", statuses: ["checking", "hold"] },
  { key: "ready", label: "Ready to send", statuses: ["ready"] },
  { key: "submitted", label: "With the insurer", statuses: ["submitted", "resubmitted"] },
  { key: "paid", label: "Paid", statuses: ["paid"] },
  { key: "refused", label: "Refused", statuses: ["refused", "partially_paid"] },
] as const;

const initials = (n?: string) => (n ?? "?").replace(/^Dr\.\s*/, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });
/** Hold reasons in plain words, without rule ids. */
const plain = (r: string) => r.replace(/^[^:]+:\s*/, "").replace(/\s*\([A-Z0-9-]+\)\s*$/, "").replace(/ — /, ": ");
const greeting = () => {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Dubai" }));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export function BillingQueues() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("hold");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<Row[] | null>(null);
  const [refusedCount, setRefusedCount] = useState<number | null>(null);
  const [toasts, setToasts] = useState<{ id: number; claimNo: string; amount: number; paid: boolean }[]>([]);
  const cursor = useRef(0);
  const current = TABS.find((t) => t.key === tab)!;

  const load = useCallback(async () => {
    const r = await fetch(`/api/claims?status=${current.statuses.join(",")}&limit=60&scope=live`).then((x) => x.json());
    setCounts(r.counts ?? {});
    setRows(r.claims ?? []);
  }, [current.statuses]);
  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);
  useEffect(() => {
    fetch("/api/recovery").then((r) => r.json()).then((r) => setRefusedCount(r.rows?.length ?? 0)).catch(() => {});
  }, []);

  // Other people's actions (doctor answers, remittances): poll the event feed every 1.5 s.
  const out = (counts.submitted ?? 0) + (counts.resubmitted ?? 0) > 0;
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/events?since=${cursor.current}`).then((x) => x.json());
        if (cursor.current > 0 && r.events?.some((e: { type: string }) => /^(claim|remittance|denial|addendum)\./.test(e.type))) void load();
        // The money arriving: a toast for every remittance.
        if (cursor.current > 0)
          for (const e of (r.events ?? []) as { seq: number; type: string; payload: { claimNo?: string; paid?: number; status?: string } }[])
            if (e.type === "remittance.received") {
              const t = { id: e.seq, claimNo: e.payload.claimNo ?? "", amount: e.payload.paid ?? 0, paid: e.payload.status === "paid" };
              setToasts((x) => [...x, t]);
              setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), 6000);
            }
        cursor.current = r.cursor ?? cursor.current;
      } catch {}
      if (!stop) setTimeout(tick, 1500);
    };
    void tick();
    const remit = setInterval(() => out && fetch("/api/remittances/poll", { method: "POST" }).catch(() => {}), 4000);
    return () => {
      stop = true;
      clearInterval(remit);
    };
  }, [load, out]);

  const count = (t: (typeof TABS)[number]) => (t.key === "refused" ? refusedCount ?? 0 : t.statuses.reduce((s, k) => s + (counts[k] ?? 0), 0));
  const attention = count(TABS[0]);

  return (
    <main className="mx-auto max-w-[1360px] px-4 md:px-6 pb-24 pt-12">
      <p className="text-[17px] font-medium text-muted-foreground">{greeting()}, Noura</p>
      <h1 className="display mt-1 text-[34px] md:text-[44px] lg:text-[52px] leading-tight">{attention ? `${attention} claim${attention > 1 ? "s" : ""} need you` : "Nothing needs you right now"}</h1>

      <div className="-mx-4 mt-8 flex max-w-[100vw] overflow-x-auto px-4 md:mx-0 md:inline-flex md:px-0"><div className="inline-flex shrink-0 rounded-full bg-black/[0.04] p-1.5">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cn("relative rounded-full px-5 py-2.5 text-[15px] font-semibold transition-colors", tab === t.key ? "text-background" : "text-muted-foreground hover:text-foreground")}>
            {tab === t.key && <motion.span layoutId="tab" className="absolute inset-0 rounded-full bg-foreground shadow" transition={{ type: "spring", bounce: 0.2, duration: 0.5 }} />}
            <span className="relative">
              {t.label} <span className={cn("ml-1 tabular-nums", tab === t.key ? "text-background/70" : "text-muted-foreground/70")}>{count(t).toLocaleString()}</span>
            </span>
          </button>
        ))}
      </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3 }} className="mt-10">
          {tab === "refused" ? (
            <RecoveryQueue />
          ) : rows === null ? (
            <SealLoader label="Loading claims" />
          ) : rows.length === 0 ? (
            <Empty tab={tab} />
          ) : tab === "hold" ? (
            <Review rows={rows} />
          ) : tab === "submitted" ? (
            <Journey rows={rows} />
          ) : tab === "paid" ? (
            <PaidList rows={rows} />
          ) : (
            <List rows={rows} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Payment toasts */}
      <div className="pointer-events-none fixed bottom-8 right-8 z-50 space-y-3">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }} className="flex items-center gap-4 rounded-3xl bg-[#07130d] px-4 md:px-6 py-4 text-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] ring-1 ring-seal-green/40">
              <span className={cn("flex size-11 items-center justify-center rounded-full", t.paid ? "bg-seal-green text-[#06120b]" : "bg-[#ff9f0a] text-black")}>{t.paid ? <CheckCircle2 className="size-6" /> : "!"}</span>
              <div>
                <div className="text-[17px] font-semibold">{t.paid ? "Paid" : "Partly refused"} · {aed(t.amount)}</div>
                <div className="font-mono text-[12px] text-white/50">{t.claimNo}</div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </main>
  );
}

/** With the insurer: each claim's journey — sent, being reviewed (live countdown), paid. */
function Journey({ rows }: { rows: Row[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {rows.map((c) => {
        const ready = c.readyAt ? new Date(c.readyAt).getTime() : null;
        const sent = c.sentAt ? new Date(c.sentAt).getTime() : null;
        const left = ready ? Math.max(0, Math.round((ready - now) / 1000)) : null;
        const progress = ready && sent ? Math.min(1, (now - sent) / Math.max(1, ready - sent)) : 0.5;
        return (
          <Link key={c._id} href={`/billing/claims/${c._id}`} className="card group p-7 transition-transform hover:-translate-y-0.5">
            <div className="flex items-center gap-4">
              <span className="flex size-12 items-center justify-center rounded-full bg-black/[0.05] text-[15px] font-semibold">{initials(c.patientName)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[20px] font-semibold">{c.patientName}</div>
                <div className="truncate text-[14px] text-muted-foreground">
                  {c.payerName} · {aed(c.net)}
                </div>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 text-[13px] font-medium">
              <Step done label="Sent" />
              <Step active={left !== 0} done={left === 0} label={left === 0 ? "Reviewed" : "Insurer reviewing"} />
              <Step label="Paid" />
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/[0.05]">
              <motion.div className="h-full rounded-full bg-gradient-to-r from-seal-green to-[#9ef0c4]" animate={{ width: `${Math.max(8, progress * 100)}%` }} transition={{ duration: 0.8 }} />
            </div>
            <div className="mt-3 text-[14px] text-muted-foreground">{left == null ? "Waiting for the insurer" : left > 0 ? `Answer expected in ${left >= 60 ? `${Math.floor(left / 60)} min ${left % 60}s` : `${left}s`}` : "Answer arriving now…"}</div>
          </Link>
        );
      })}
    </div>
  );
}

function Step({ label, done, active }: { label: string; done?: boolean; active?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2 rounded-full px-3 py-2", done ? "bg-seal-green/15 text-[#178a4c]" : active ? "bg-black/[0.05]" : "text-muted-foreground")}>
      <span className={cn("relative flex size-2.5 rounded-full", done ? "bg-seal-green" : active ? "bg-[#ff9f0a]" : "bg-black/15")}>{active && !done && <span className="absolute inset-0 animate-ping rounded-full bg-[#ff9f0a]" />}</span>
      {label}
    </div>
  );
}

/** Paid: done and dusted. */
function PaidList({ rows }: { rows: Row[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {rows.map((c, i) => (
        <motion.div key={c._id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
          <Link href={`/billing/claims/${c._id}`} className="relative block overflow-hidden rounded-[28px] bg-[#07130d] p-7 text-white ring-1 ring-seal-green/25 transition-transform hover:-translate-y-0.5">
            <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-seal-green/20 blur-3xl" />
            <div className="relative flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-seal-green px-3 py-1 text-[13px] font-semibold text-[#06120b]">
                <CheckCircle2 className="size-4" /> Paid
              </span>
              <span className="text-[13px] text-white/45">{c.paidAt ? when(c.paidAt) : ""}</span>
            </div>
            <div className="relative mt-6 text-[22px] font-semibold">{c.patientName}</div>
            <div className="relative text-[14px] text-white/55">{c.providerName} · {c.payerName}</div>
            <div className="display relative mt-5 text-[28px] md:text-[40px] leading-none">{aed(c.paidAmount ?? c.net)}</div>
            <div className="relative mt-2 text-[13px] text-white/45">first time, no refusals</div>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}

/** Tinder-style review: drag or click through the held claims; the panel follows the card on top. */
function Review({ rows }: { rows: Row[] }) {
  const deck = rows.slice(0, 8);
  const [top, setTop] = useState(0);
  const c = deck[top] ?? deck[0];
  const cards = useMemo(() => deck.map((r) => <ClaimCard key={r._id} r={r} />), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-[560px_1fr] items-center gap-6 lg:gap-16">
        <div className="relative mx-auto h-[400px] w-full max-w-[520px] md:h-[440px] lg:mx-0">
          <Stack cards={cards} layout="cascade" visible={4} spread={0.35} radius={32} sendToBackOnClick onChange={(i) => setTop(i)} className="h-[380px] w-[calc(100%-16px)] max-w-[500px] md:h-[420px]" />
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={c._id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
            <div className="text-[14px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Why it is held</div>
            <ul className="mt-4 space-y-3">
              {(c.check?.holdReasons ?? ["Checking now…"]).map((h) => (
                <li key={h} className="flex gap-3 text-[19px] leading-snug">
                  <span className="mt-2.5 size-2 shrink-0 rounded-full bg-risk-high" />
                  {plain(h)}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex items-center gap-3">
              <Link href={`/billing/claims/${c._id}`} className="inline-flex items-center gap-2.5 rounded-full bg-foreground px-5 md:px-7 py-4 text-[17px] font-semibold text-background shadow-[0_12px_30px_-10px_rgba(0,0,0,0.5)] transition-transform hover:scale-[1.02]">
                Open and fix <ArrowRight className="size-5" />
              </Link>
              <span className="flex items-center gap-2 text-[14px] text-muted-foreground">
                <Hand className="size-4" /> Drag or tap the card for the next claim
              </span>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      {rows.length > deck.length && <p className="mt-6 text-[14px] text-muted-foreground">Showing the {deck.length} newest of {rows.length}.</p>}
      <div className="mt-14">
        <List rows={rows} />
      </div>
    </div>
  );
}

function ClaimCard({ r }: { r: Row }) {
  const p = r.status === "checking" ? null : r.riskScore;
  return (
    <div className="flex h-full w-full flex-col justify-between bg-white p-5 md:p-8 text-foreground">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <span className="flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-[#1d1d1f] to-[#55555a] text-[22px] font-semibold text-white">{initials(r.patientName)}</span>
          <div>
            <div className="text-[28px] font-bold leading-tight tracking-tight">{r.patientName}</div>
            <div className="text-[15px] text-muted-foreground">{r.providerName ?? "Seabreeze Specialty Hospital"}</div>
          </div>
        </div>
        <StatusPill status={r.status} className="text-[13px]" />
      </div>
      <div>
        <div className="text-[14px] text-muted-foreground">Claim value</div>
        <div className="text-[30px] md:text-[44px] font-bold tracking-tight tabular-nums">{aed(r.net)}</div>
        <div className="mt-1 flex items-center gap-2 text-[15px]">
          <ShieldCheck className="size-4 text-[#178a4c]" /> {r.payerName}
        </div>
      </div>
      <div>
        <div className="flex items-baseline justify-between text-[14px]">
          <span className="text-muted-foreground">Chance of refusal</span>
          {p != null && <span className={cn("text-[22px] font-bold", riskText[riskBand(p)])}>{Math.round(p * 100)}%</span>}
        </div>
        <RiskBar p={p} className="mt-2 [&>span]:hidden" />
        <div className="mt-3 truncate text-[14px] text-muted-foreground">{r.versions[0].lines.map((l) => l.label ?? l.code).join(" · ")}</div>
      </div>
    </div>
  );
}

function List({ rows }: { rows: Row[] }) {
  return (
    <div className="card overflow-hidden !p-0">
      {rows.map((c, i) => (
        <Link key={c._id} href={`/billing/claims/${c._id}`} className={cn("group grid grid-cols-2 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_150px_160px_24px] items-center gap-6 px-5 md:px-7 py-5 transition-colors hover:bg-black/[0.02]", i > 0 && "border-t border-black/[0.05]")}>
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-[15px] font-semibold">{initials(c.patientName)}</span>
            <div className="min-w-0">
              <div className="truncate text-[18px] font-semibold">{c.patientName}</div>
              <div className="truncate text-[14px] text-muted-foreground">
                {c.providerName ?? ""} · {when(c.createdAt)}
              </div>
            </div>
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium">{c.payerName}</div>
            <div className="truncate text-[13px] text-muted-foreground">{c.status === "hold" && c.check?.holdReasons?.[0] ? plain(c.check.holdReasons[0]) : <StatusPill status={c.status} />}</div>
          </div>
          <span className="text-right text-[18px] font-semibold tabular-nums">{aed(c.net)}</span>
          {c.status === "checking" ? <RiskBar p={null} /> : c.riskScore == null ? <span className="text-[13px] text-muted-foreground">—</span> : <RiskBar p={c.riskScore} />}
          <ArrowRight className="hidden size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 md:block" />
        </Link>
      ))}
    </div>
  );
}

function Empty({ tab }: { tab: string }) {
  const text: Record<string, [string, string]> = {
    hold: ["All clear", "Every checked claim is either ready or with the insurer."],
    ready: ["Nothing waiting to send", "Claims appear here once SEAL has checked them and found no problems."],
    submitted: ["Nothing with the insurer", "Sent claims wait here until the remittance arrives."],
    paid: ["No payments yet today", "Claims land here the moment the insurer pays them."],
  };
  const [h, p] = text[tab] ?? ["Nothing here", ""];
  return (
    <div className="card flex flex-col items-center px-5 md:px-8 py-20 text-center">
      <CheckCircle2 className="size-12 text-seal-green" />
      <div className="display mt-4 text-[32px]">{h}</div>
      <p className="mt-2 max-w-md text-[17px] text-muted-foreground">{p}</p>
    </div>
  );
}
