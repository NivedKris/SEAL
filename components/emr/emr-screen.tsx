"use client";

import { SealLoader } from "@/components/brand/seal-loader";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ExternalLink, Loader2, ShieldCheck, Sparkles, X } from "lucide-react";
import { SealLogo } from "@/components/brand/seal-logo";
import ShinyText from "@/components/ShinyText";
import { CodePicker } from "@/components/shared/code-picker";
import { cn } from "@/lib/utils";

// ── Types from the EMR API and SEAL's check API ───────────────────────────────
type Order = { _id: string; code: string; label: string; kind: string; quantity: number; justificationStatus: string };
type Dx = { _id: string; icd10: string; description?: string; primary: boolean };
type Enc = {
  encounter: { _id: string; complaint: string; findings: string; plan?: string; start: string; status: string; type: number; scenario?: string; theme?: string };
  patient: { name: string; sex: string; age: number; maskedId: string; nationality: string };
  insurance: { payer: string; plan: string; memberNo: string; validTo: string; copayPct: number };
  provider: { name: string; specialty: string };
  orders: Order[];
  diagnoses: Dx[];
  priorAuths: { authNo: string; codes: string[]; approvedQty: number }[];
  claim: { _id: string; claimNo: string; status: string } | null;
};
type Card = {
  ruleId: string;
  title: string;
  denialCode: string;
  severity: string;
  kind: "documentation" | "fix" | "link_diagnosis";
  certainty: "risk" | "possible";
  insurerNeeds: string;
  missing: { concept: string; text: string }[];
  evidence: string[];
  fixTemplates: string[];
  fixActions: string[];
  qualifyingCodes?: string[];
  source: { publisher: string; title: string; url: string; verified: boolean };
};
type OrderResult = { orderId: string; code: string; label: string; kind: string; status: "justified" | "at_risk" | "checking"; cards: Card[] };
type Check = { mode: "rules" | "live" | "deep"; ms: number; orders: OrderResult[]; model?: string; provider?: string; aiError?: string };
type OpenEnc = { _id: string; patientName?: string; scenario?: string; theme?: string; start: string; providerName?: string; complaint?: string };

const RANK = { rules: 0, live: 1, deep: 2 } as const;
const GROUPS: { key: string; label: string; kinds: string[] }[] = [
  { key: "lab", label: "Laboratory", kinds: ["lab"] },
  { key: "imaging", label: "Imaging", kinds: ["imaging"] },
  { key: "procedure", label: "Procedures and therapy", kinds: ["procedure", "therapy"] },
];
const initials = (n?: string) => (n ?? "?").replace(/^Dr\.\s*/, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });
/** Reason for the visit from the patient's own words (first clause of the complaint). */
const reason = (x: { complaint?: string }) => (x.complaint ?? "Consultation").split(/[.;,]/)[0].replace(/^(patient reports|attends for an?|attends for)\s+/i, "").replace(/^\w/, (c) => c.toUpperCase());

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json();
  if (j?.error) throw new Error(j.error);
  return j as T;
}

export function EmrScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const [list, setList] = useState<OpenEnc[]>([]);
  const id = params.get("e") ?? list[0]?._id ?? null;
  const [data, setData] = useState<Enc | null>(null);
  const [note, setNote] = useState({ complaint: "", findings: "", plan: "" });
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [resolved, setResolved] = useState<{ key: string; title: string; order: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const accepted = useRef({ rev: -1, rank: -1 });
  const rev = useRef(0);
  const atRiskSeen = useRef(new Map<string, { title: string; order: string }>());
  const timers = useRef<{ live?: ReturnType<typeof setTimeout>; deep?: ReturnType<typeof setTimeout> }>({});

  useEffect(() => {
    api<{ encounters: OpenEnc[] }>("/api/encounters?status=open").then((r) => setList(r.encounters)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!id) return null;
    const r = await api<Enc>(`/api/emr/encounters/${id}`);
    setData(r);
    return r;
  }, [id]);

  // ── SEAL checks: rules at once, fast model right after, reasoning model on a pause ──
  const runCheck = useCallback(
    async (mode: Check["mode"], n: typeof note) => {
      if (!id) return;
      const myRev = rev.current;
      setBusy((b) => ({ ...b, [mode]: true }));
      try {
        const r = await api<Check>(`/api/encounters/${id}/check`, { method: "POST", body: JSON.stringify({ mode, note: n }) });
        const a = accepted.current;
        if (myRev < a.rev || (myRev === a.rev && RANK[mode] < a.rank)) return; // stale or weaker than what's shown
        accepted.current = { rev: myRev, rank: RANK[mode] };
        const now = new Set(r.orders.flatMap((o) => o.cards.filter((c) => c.certainty === "risk").map((c) => `${o.orderId}|${c.ruleId}`)));
        const done: { key: string; title: string; order: string }[] = [];
        if (mode !== "rules")
          for (const [k, v] of atRiskSeen.current)
            if (!now.has(k)) {
              done.push({ key: k, ...v });
              atRiskSeen.current.delete(k);
            }
        for (const o of r.orders) for (const c of o.cards) if (c.certainty === "risk") atRiskSeen.current.set(`${o.orderId}|${c.ruleId}`, { title: c.title, order: o.label });
        if (done.length) setResolved((xs) => [...done, ...xs].slice(0, 6));
        setCheck(r);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy((b) => ({ ...b, [mode]: false }));
      }
    },
    [id],
  );

  const recheck = useCallback(
    (n: typeof note, { immediate }: { immediate: boolean }) => {
      rev.current++;
      clearTimeout(timers.current.live);
      clearTimeout(timers.current.deep);
      const go = () => {
        void runCheck("rules", n).then(() => runCheck("live", n));
      };
      if (immediate) go();
      else timers.current.live = setTimeout(go, 500);
      timers.current.deep = setTimeout(() => {
        if (id) void api(`/api/emr/encounters/${id}`, { method: "PATCH", body: JSON.stringify(n) }).catch(() => {});
        void runCheck("deep", n);
      }, immediate ? 1800 : 2500);
    },
    [runCheck, id],
  );

  useEffect(() => {
    setCheck(null);
    setResolved([]);
    setError(null);
    atRiskSeen.current.clear();
    accepted.current = { rev: -1, rank: -1 };
    void load().then((r) => {
      if (!r) return;
      const n = { complaint: r.encounter.complaint, findings: r.encounter.findings, plan: r.encounter.plan ?? "" };
      setNote(n);
      if (r.encounter.status === "open") recheck(n, { immediate: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const editNote = (k: keyof typeof note, v: string) => {
    const n = { ...note, [k]: v };
    setNote(n);
    recheck(n, { immediate: false });
  };

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      recheck(note, { immediate: true });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const sign = async () => {
    if (!id) return;
    setSigning(true);
    setError(null);
    try {
      await api(`/api/emr/encounters/${id}`, { method: "PATCH", body: JSON.stringify(note) });
      const r = await api<{ claim: { _id: string } }>(`/api/encounters/${id}/sign`, { method: "POST", headers: { "x-seal-user": "dr-omar-haddad" } });
      router.push(`/billing/claims/${r.claim._id}`);
    } catch (e) {
      setError((e as Error).message);
      setSigning(false);
    }
  };

  const open = data?.encounter.status === "open";
  const active = data?.orders.filter((o) => o.justificationStatus !== "removed") ?? [];
  const result = (o: Order) => check?.orders.find((r) => r.orderId === o._id);
  const atRisk = check?.orders.filter((o) => o.status === "at_risk").length ?? 0;
  const anyBusy = busy.rules || busy.live || busy.deep;

  return (
    <main className="mx-auto grid max-w-[1560px] grid-cols-[260px_1fr_400px] gap-6 px-6 py-8">
      {/* ── Today's clinic ── */}
      <aside className="sticky top-[88px] self-start">
        <div className="px-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Today&apos;s clinic</div>
        <div className="mt-3 space-y-1.5">
          {list.map((x) => (
            <button key={x._id} onClick={() => router.push(`/emr?e=${x._id}`)} className={cn("flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all", x._id === id ? "bg-white shadow-[0_8px_30px_-12px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.06]" : "hover:bg-white/60")}>
              <span className={cn("shrink-0 rounded-full p-[2.5px]", x._id === id ? "bg-gradient-to-tr from-seal-green via-[#9ef0c4] to-[#2a78d6] shadow-[0_0_18px_-4px_rgba(62,207,127,0.8)]" : "bg-gradient-to-tr from-seal-green/70 to-[#2a78d6]/60")}>
                <span className={cn("flex size-10 items-center justify-center rounded-full border-2 border-white text-[13px] font-semibold", x._id === id ? "bg-foreground text-background" : "bg-[#f1f1f4]")}>{initials(x.patientName)}</span>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold">{x.patientName}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {time(x.start)} · {reason(x)}
                </span>
              </span>
            </button>
          ))}
          {list.length === 0 && <p className="px-2 text-[14px] text-muted-foreground">No patients waiting.</p>}
        </div>
      </aside>

      {/* ── The encounter ── */}
      <section className="min-w-0 space-y-5">
        {!data ? (
          <div className="card"><SealLoader label="Opening the encounter" /></div>
        ) : (
          <>
            <motion.div key={data.encounter._id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="card relative overflow-hidden p-8">
              <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-seal-green/10 blur-3xl" />
              <div className="relative flex items-start gap-6">
                <span className="flex size-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1d1d1f] to-[#55555a] text-[26px] font-semibold text-white shadow-xl">{initials(data.patient.name)}</span>
                <div className="min-w-0 flex-1">
                  <h1 className="display text-[40px] leading-tight">{data.patient.name}</h1>
                  <div className="mt-2 flex flex-wrap gap-2 text-[14px]">
                    <Pill>
                      {data.patient.sex === "M" ? "Male" : "Female"}, {data.patient.age}
                    </Pill>
                    <Pill>{data.patient.nationality}</Pill>
                    <Pill>
                      <ShieldCheck className="size-3.5 text-[#178a4c]" /> {data.insurance.payer} · {data.insurance.plan}
                    </Pill>
                    <Pill muted>Member {data.insurance.memberNo}</Pill>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[16px] font-semibold">{data.provider.name}</div>
                  <div className="text-[13px] capitalize text-muted-foreground">{data.provider.specialty.replace(/_/g, " ")}</div>
                  <div className="mt-1 text-[13px] text-muted-foreground">{new Date(data.encounter.start).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" })}</div>
                </div>
              </div>
            </motion.div>

            {error && <div className="rounded-2xl bg-risk-high/[0.07] px-5 py-3 text-[14px] text-risk-high">{error}</div>}
            {!open && data.claim && (
              <Link href={`/billing/claims/${data.claim._id}`} className="card flex items-center justify-between px-6 py-4 text-[15px]">
                <span>
                  Signed. Claim <span className="font-mono">{data.claim.claimNo}</span> is with billing.
                </span>
                <ArrowRight className="size-4" />
              </Link>
            )}

            <NoteCard title="What the patient says" hint="In the patient's own words" value={note.complaint} disabled={!open} rows={3} onChange={(v) => editNote("complaint", v)} />
            <NoteCard title="What you found" hint="Examination findings" value={note.findings} disabled={!open} rows={4} onChange={(v) => editNote("findings", v)} />
            <NoteCard title="Plan" value={note.plan} disabled={!open} rows={2} onChange={(v) => editNote("plan", v)} />

            <div className="card p-6">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-[19px] font-semibold">Diagnoses</h2>
                {open && <CodePicker type="icd" placeholder="Add a diagnosis" onPick={(c) => act(() => api(`/api/emr/encounters/${id}/diagnoses`, { method: "POST", body: JSON.stringify({ icd10: c }) }))} />}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {data.diagnoses.map((x) => (
                  <span key={x._id} className="inline-flex items-center gap-2 rounded-full bg-black/[0.04] py-1.5 pl-3.5 pr-2 text-[14px]">
                    {x.primary && <span className="size-1.5 rounded-full bg-foreground" />}
                    {x.description}
                    <span className="font-mono text-[11px] text-muted-foreground">{x.icd10}</span>
                    {open && (
                      <button onClick={() => act(() => api(`/api/emr/encounters/${id}/diagnoses/${x._id}`, { method: "DELETE" }))} className="rounded-full p-0.5 text-muted-foreground hover:bg-black/[0.06] hover:text-foreground" aria-label="Remove diagnosis">
                        <X className="size-3.5" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>

            <div className="card p-6">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-[19px] font-semibold">Orders</h2>
                {open && <CodePicker type="cpt" placeholder="Order a test, scan or procedure" onPick={(c) => act(() => api(`/api/emr/encounters/${id}/orders`, { method: "POST", body: JSON.stringify({ code: c }) }))} />}
              </div>
              <div className="mt-4 space-y-5">
                {GROUPS.map((g) => {
                  const os = active.filter((o) => g.kinds.includes(o.kind));
                  if (!os.length) return null;
                  return (
                    <div key={g.key}>
                      <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{g.label}</div>
                      <div className="space-y-2">
                        {os.map((o) => {
                          const st = result(o)?.status;
                          return (
                            <div key={o._id} className={cn("flex items-center gap-4 rounded-2xl px-4 py-3.5 ring-1 transition-colors", st === "at_risk" ? "bg-risk-high/[0.04] ring-risk-high/20" : st === "justified" ? "bg-risk-low/[0.04] ring-risk-low/15" : "bg-black/[0.02] ring-black/[0.05]")}>
                              <span className={cn("relative flex size-3 shrink-0 rounded-full", st === "at_risk" ? "bg-risk-high" : st === "justified" ? "bg-risk-low" : "bg-risk-mid")}>
                                {(st === "checking" || (!st && anyBusy)) && <span className="absolute inset-0 animate-ping rounded-full bg-risk-mid" />}
                              </span>
                              <span className="flex-1 text-[16px] font-medium">
                                {o.label}
                                {o.quantity > 1 && <span className="text-muted-foreground"> × {o.quantity}</span>}
                              </span>
                              {data.priorAuths.some((p) => p.codes.includes(o.code)) && <span className="rounded-full bg-risk-low/10 px-2.5 py-0.5 text-[12px] font-medium text-risk-low">Approved</span>}
                              <span className="font-mono text-[12px] text-muted-foreground">{o.code}</span>
                              {open && (
                                <button onClick={() => act(() => api(`/api/emr/encounters/${id}/orders/${o._id}`, { method: "DELETE" }))} className="rounded-full p-1 text-muted-foreground hover:bg-black/[0.06] hover:text-foreground" aria-label="Remove order">
                                  <X className="size-4" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {active.length === 0 && <p className="text-[15px] text-muted-foreground">No orders yet.</p>}
                <p className="text-[13px] text-muted-foreground">Medicines are prescribed through eRx and are not part of this claim.</p>
              </div>
            </div>

            {open && (
              <div className="flex items-center justify-end gap-4 pt-2">
                <span className="text-[14px] text-muted-foreground">{atRisk ? `${atRisk} order${atRisk > 1 ? "s" : ""} still at risk` : check ? "Every order is supported" : ""}</span>
                <button onClick={sign} disabled={signing} className="inline-flex items-center gap-2.5 rounded-full bg-foreground px-8 py-4 text-[17px] font-semibold text-background shadow-[0_12px_30px_-10px_rgba(0,0,0,0.5)] transition-transform hover:scale-[1.02] disabled:opacity-60">
                  {signing ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />} Sign and send to billing
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── SEAL ── */}
      <aside className="sticky top-[88px] self-start">
        <div className="relative overflow-hidden rounded-[30px] bg-[#0b0b0d] p-6 text-white shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
          <div className="pointer-events-none absolute -left-20 -top-28 size-72 rounded-full bg-seal-green/25 blur-3xl" />
          <div className="relative flex items-center justify-between">
            <span className="text-white">
              <SealLogo height={22} />
            </span>
            {anyBusy ? <ShinyText text="checking" color="#8e8e93" shineColor="#ffffff" speed={1.6} className="text-[13px]" /> : <span className="text-[13px] text-white/50">watching</span>}
          </div>
          <div className="relative mt-6 flex items-center gap-4">
            <Ring total={active.length} risk={atRisk} pending={!check} />
            <div>
              <div className="text-[26px] font-semibold leading-tight">{!check ? "Reading the note…" : atRisk ? `${atRisk} at risk` : "All clear"}</div>
              <div className="text-[14px] text-white/55">
                {active.length} order{active.length === 1 ? "" : "s"} checked{check?.mode === "deep" ? " in depth" : ""}
              </div>
            </div>
          </div>
          {check?.aiError && <p className="relative mt-3 text-[12px] text-amber-300/90">AI check paused; insurer rules still applied.</p>}

          <div className="relative mt-6 max-h-[calc(100vh-330px)] space-y-3 overflow-y-auto pr-1">
            <AnimatePresence initial={false}>
              {check?.orders.flatMap((o) =>
                o.cards.map((c) => (
                  <motion.div key={`${o.orderId}|${c.ruleId}|${c.kind}`} layout initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40, scale: 0.95 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
                    <RiskCard
                      order={o}
                      card={c}
                      open={open}
                      onAddText={(t) => editNote("findings", `${note.findings.trim()} ${t}`.trim())}
                      onLinkDx={(code) => act(() => api(`/api/emr/encounters/${id}/diagnoses`, { method: "POST", body: JSON.stringify({ icd10: code }) }))}
                      onRemove={() => act(() => api(`/api/emr/encounters/${id}/orders/${o.orderId}`, { method: "DELETE" }))}
                      onPriorAuth={() => act(() => api(`/api/emr/encounters/${id}/prior-auth`, { method: "POST", body: JSON.stringify({ orderId: o.orderId }) }))}
                    />
                  </motion.div>
                )),
              )}
              {resolved.map((r) => (
                <motion.div key={`ok-${r.key}`} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-start gap-3 rounded-2xl bg-seal-green/15 px-4 py-3.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-seal-green text-black">
                    <Check className="size-3.5" />
                  </span>
                  <div className="text-[14px]">
                    <div className="font-semibold text-seal-green">Resolved</div>
                    <div className="text-white/70">{r.order}</div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {check && atRisk === 0 && resolved.length === 0 && (
              <div className="flex items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-4 text-[15px] text-white/80">
                <Sparkles className="size-5 text-seal-green" /> Every order is supported by the note.
              </div>
            )}
          </div>
        </div>
      </aside>
    </main>
  );
}

function Pill({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1", muted ? "text-muted-foreground" : "bg-black/[0.04]")}>{children}</span>;
}

function NoteCard({ title, hint, value, onChange, disabled, rows }: { title: string; hint?: string; value: string; onChange: (v: string) => void; disabled?: boolean; rows: number }) {
  return (
    <div className="card p-6 transition-shadow focus-within:shadow-[0_0_0_4px_rgba(62,207,127,0.15),0_12px_40px_-12px_rgba(0,0,0,0.1)]">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[19px] font-semibold">{title}</h2>
        {hint && <span className="text-[13px] text-muted-foreground">{hint}</span>}
      </div>
      <textarea disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} className="mt-3 w-full resize-none bg-transparent text-[17px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:text-muted-foreground" placeholder="Type here…" />
    </div>
  );
}

function Ring({ total, risk, pending }: { total: number; risk: number; pending: boolean }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const ok = total ? (total - risk) / total : 1;
  return (
    <svg width={76} height={76} className="-rotate-90 shrink-0">
      <circle cx={38} cy={38} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={8} />
      {!pending && risk > 0 && <circle cx={38} cy={38} r={r} fill="none" stroke="#ff453a" strokeWidth={8} />}
      {!pending && <circle cx={38} cy={38} r={r} fill="none" stroke="#3ecf7f" strokeWidth={8} strokeLinecap="round" strokeDasharray={`${c * ok} ${c}`} style={{ transition: "stroke-dasharray 700ms cubic-bezier(.22,1,.36,1)" }} />}
    </svg>
  );
}

/** One risk card: what the insurer needs, the note words SEAL read, and fixes the doctor applies. */
function RiskCard({ order, card, open, onAddText, onLinkDx, onRemove, onPriorAuth }: { order: OrderResult; card: Card; open: boolean; onAddText: (t: string) => void; onLinkDx: (code: string) => void; onRemove: () => void; onPriorAuth: () => void }) {
  const possible = card.certainty === "possible";
  return (
    <article className="rounded-3xl bg-white p-5 text-foreground">
      <div className="flex items-center gap-2 text-[13px]">
        <span className={cn("size-2 rounded-full", possible ? "bg-risk-mid" : "bg-risk-high")} />
        <span className="font-semibold">{order.label}</span>
        <span className="ml-auto text-muted-foreground">{possible ? "checking…" : "may be refused"}</span>
      </div>
      <h3 className="mt-2.5 text-[17px] font-semibold leading-snug">{card.title}</h3>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">The insurer needs </span>
        {card.insurerNeeds.replace(/^\w/, (x) => x.toLowerCase())}
      </p>
      {card.evidence.length > 0 && (
        <p className="mt-3 text-[13px] text-muted-foreground">
          SEAL read: <mark className="rounded-md bg-seal-green/25 px-1.5 py-0.5 text-foreground">{card.evidence[0]}</mark>
        </p>
      )}
      {card.missing.length > 0 && !possible && (
        <ul className="mt-3 space-y-1 text-[13px]">
          {card.missing.map((m) => (
            <li key={m.concept} className="flex gap-2">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-risk-high" />
              <span>Not in the note yet: {m.text.replace(/^\w/, (x) => x.toLowerCase())}</span>
            </li>
          ))}
        </ul>
      )}
      {open && !possible && (
        <div className="mt-4 space-y-2.5">
          {card.kind === "documentation" && card.fixTemplates.map((t) => <Template key={t} template={t} onAdd={onAddText} />)}
          {(card.kind === "link_diagnosis" || (card.fixActions.includes("link_diagnosis") && card.kind !== "fix")) && card.qualifyingCodes && <CodePicker type="icd" patterns={card.qualifyingCodes} placeholder="Link a documented diagnosis" onPick={onLinkDx} block />}
          <div className="flex flex-wrap gap-2">
            {card.fixActions.includes("request_prior_auth") && (
              <button onClick={onPriorAuth} className="rounded-full bg-foreground px-4 py-2 text-[13px] font-semibold text-background">
                Request approval
              </button>
            )}
            {card.fixActions.includes("remove_order") && (
              <button onClick={onRemove} className="rounded-full bg-black/[0.05] px-4 py-2 text-[13px] font-semibold hover:bg-black/[0.08]">
                Remove order
              </button>
            )}
          </div>
        </div>
      )}
      <a href={card.source.url} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground">
        {card.source.verified && <ShieldCheck className="size-3.5 text-risk-low" />}
        {card.source.publisher} <ExternalLink className="size-3" />
      </a>
    </article>
  );
}

/** Fix template with ____ blanks: the doctor types every blank; SEAL writes nothing for them. */
function Template({ template, onAdd }: { template: string; onAdd: (text: string) => void }) {
  const parts = template.split("____");
  const [vals, setVals] = useState<string[]>(() => parts.slice(1).map(() => ""));
  const filled = vals.every((v) => v.trim());
  return (
    <div className="rounded-2xl bg-black/[0.035] p-3.5">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-2 text-[14px] leading-relaxed">
        {parts.map((p, i) => (
          <span key={i} className="contents">
            <span>{p}</span>
            {i < parts.length - 1 && <input value={vals[i]} onChange={(e) => setVals((v) => v.map((x, j) => (j === i ? e.target.value : x)))} className="w-24 rounded-lg bg-white px-2 py-1 text-[14px] outline-none ring-1 ring-black/10 focus:ring-2 focus:ring-seal-green" />}
          </span>
        ))}
      </div>
      <button disabled={!filled} onClick={() => onAdd(parts.map((p, i) => p + (vals[i] ?? "")).join(""))} className="mt-3 rounded-full bg-foreground px-4 py-1.5 text-[13px] font-semibold text-background disabled:opacity-25">
        Add to my note
      </button>
    </div>
  );
}
