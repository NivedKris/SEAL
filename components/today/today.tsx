"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useData } from "@/lib/client/data";
import { useAssistantScreen } from "@/components/assistant/store";
import { motion } from "motion/react";
import { ArrowUpRight, CircleHelp, FileWarning, Gavel } from "lucide-react";
import { SealLoader } from "@/components/brand/seal-loader";
import type { TodayMetrics } from "@/lib/today/metrics";
import { cn } from "@/lib/utils";

type View = "everyone" | "doctor" | "coder" | "biller" | "finance";
const VIEWS: { key: View; label: string }[] = [
  { key: "everyone", label: "Everyone" },
  { key: "doctor", label: "Doctor" },
  { key: "coder", label: "Coder" },
  { key: "biller", label: "Biller" },
  { key: "finance", label: "Finance" },
];
/** Which stages of the thread matter most to each role. */
const FOCUS: Record<View, string[]> = {
  everyone: [],
  doctor: ["seen", "signed", "questions"],
  coder: ["signed", "attention", "ready"],
  biller: ["attention", "ready", "insurer", "accepted"],
  finance: ["insurer", "accepted"],
};
const ORDER: Record<View, ("money" | "doctors" | "needs")[]> = {
  everyone: ["money", "doctors", "needs"],
  doctor: ["doctors", "needs", "money"],
  coder: ["needs", "doctors", "money"],
  biller: ["needs", "money", "doctors"],
  finance: ["money", "needs", "doctors"],
};

const aed = (n: number) => `AED ${Math.round(n).toLocaleString("en")}`;
const pct = (p: number | null | undefined) => (p == null ? "—" : `${Math.round(p * 100)}%`);
const initials = (n: string) => n.replace(/^Dr\.\s*/, "").replace(/,.*$/, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("");

export function Today({ initial }: { initial?: Promise<TodayMetrics | null> }) {
  const { data: m, error } = useData<TodayMetrics>("/api/today", { initial, refreshMs: 20_000 });
  const err = m ? null : error ? "SEAL could not load today's numbers." : null;
  const [view, setView] = useState<View>("everyone");
  useAssistantScreen(m ? { title: "Today", items: [...m.needsYou.map((x) => ({ id: x.href, kind: x.kind, label: `${x.title}: ${x.detail}${x.amount ? ` · AED ${Math.round(x.amount)}` : ""} (opens ${x.href})` })), ...m.doctors.slice(0, 14).map((x) => ({ id: x.id, kind: "doctor", label: `${x.name} · ${x.specialty} · ${x.patientsToday} patients today` }))] } : null);

  useEffect(() => {
    try {
      const v = localStorage.getItem("seal-view") as View | null;
      if (v && VIEWS.some((x) => x.key === v)) setView(v);
    } catch {}
  }, []);
  const pick = (v: View) => {
    setView(v);
    try {
      localStorage.setItem("seal-view", v);
    } catch {}
  };

  if (err) return <main className="mx-auto max-w-[1400px] px-6 py-24 text-center text-muted-foreground">{err}</main>;
  if (!m) return <SealLoader className="min-h-[70vh]" size={44} label="Gathering today" />;

  const sections = { money: <Money key="money" m={m} />, doctors: <Doctors key="doctors" m={m} />, needs: <NeedsAndInsurers key="needs" m={m} /> };

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-28 pt-10 md:px-8">
      {/* Greeting */}
      <section className="rise flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">{m.date} · Dubai</p>
          {m.hospital && (
            <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/60 px-3 py-1 text-[12px] font-light text-ink/70 ring-1 ring-ink/[0.07]">
              <span className="size-1.5 rounded-full bg-seal-deep" />
              Tuned on <span className="dot text-[14px] text-ink">{m.hospital.claims.toLocaleString("en")}</span> of {m.hospital.name}&apos;s own claims · {new Date(m.hospital.from).toLocaleDateString("en-GB", { month: "short", year: "numeric" })} – {new Date(m.hospital.to).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
            </p>
          )}
          <h1 className="display mt-4 text-[44px] leading-[1.05] sm:text-[60px]">{m.greeting}.</h1>
          <p className="mt-3 flex items-start gap-3 text-[17px] font-light leading-relaxed text-ink/70 sm:items-center sm:text-[18px]">
            <span className="relative mt-1 flex size-5 shrink-0 items-center justify-center sm:mt-0">
              <span className="absolute inset-0 rounded-full bg-gradient-to-br from-white to-[#f4e6cf] ring-1 ring-ink/10" />
              <span className="heartbeat relative size-2 rounded-full bg-[#f0b45a] shadow-[0_0_10px_2px_rgba(240,180,90,0.55)]" />
            </span>
            <span>
              SEAL is watching <span className="dot text-[22px] text-ink">{m.watching}</span> claims and visits today.
            </span>
          </p>
        </div>
        <div className="flex w-full gap-1 overflow-x-auto rounded-full bg-white/50 p-1 ring-1 ring-ink/[0.07] backdrop-blur md:w-auto" role="tablist" aria-label="View as">
          {VIEWS.map((v) => (
            <button key={v.key} role="tab" aria-selected={view === v.key} onClick={() => pick(v.key)} className={cn("whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-light transition-all", view === v.key ? "bg-white text-ink shadow-[0_0_0_1px_rgba(31,43,41,0.08),0_6px_18px_-8px_rgba(31,43,41,0.3)]" : "text-ink/55 hover:text-ink")}>
              {v.label}
            </button>
          ))}
        </div>
      </section>

      <Thread m={m} focus={FOCUS[view]} />

      <div className="mt-14 space-y-14">{ORDER[view].map((k) => sections[k])}</div>
    </main>
  );
}

// ── The thread: today's claims, stage by stage ───────────────────────────────
function Thread({ m, focus }: { m: TodayMetrics; focus: string[] }) {
  const n = m.thread.length;
  return (
    <section className="rise rise-1 mt-12">
      <p className="eyebrow">Today&apos;s claims, from the doctor&apos;s room to the insurer</p>
      <div className="-mx-4 mt-6 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        <div className="relative min-w-[920px]">
          {/* the line of light */}
          <svg className="absolute left-0 top-[18px] h-3 w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 2">
            <line x1={100 / n / 2} y1="1" x2={100 - 100 / n / 2} y2="1" stroke="rgba(31,43,41,0.22)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
            <line x1={100 / n / 2} y1="1" x2={100 - 100 / n / 2} y2="1" stroke="#ffffff" strokeWidth="2.5" vectorEffect="non-scaling-stroke" className="thread-flow" />
          </svg>
          <div className="relative grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {m.thread.map((t, i) => {
              const lit = !focus.length || focus.includes(t.key);
              const warn = t.key === "attention" || t.key === "questions";
              return (
                <Link key={t.key} href={t.href} className={cn("group flex flex-col items-center px-1.5 text-center transition-opacity", !lit && "opacity-35 hover:opacity-80")}>
                  <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.15 + i * 0.07, duration: 0.6 }} className="relative flex size-10 items-center justify-center">
                    <span className={cn("absolute inset-0 rounded-full bg-white/80 ring-1 ring-ink/10 backdrop-blur", lit && "shadow-[0_0_20px_2px_rgba(255,255,255,0.9)]")} />
                    <span className={cn("relative size-2.5 rounded-full", warn && t.n > 0 ? "bg-seal-amber" : t.key === "accepted" ? "bg-seal-deep" : "bg-ink/60")} />
                  </motion.span>
                  <div className="card mt-4 w-full !rounded-[22px] px-3 py-4 transition-transform group-hover:-translate-y-0.5">
                    <div className="eyebrow !text-[10px] !tracking-[0.18em]">{t.label}</div>
                    <div className={cn("dot mt-2 text-[40px] leading-none", warn && t.n > 0 ? "text-seal-amber" : t.key === "accepted" ? "text-seal-deep" : "text-ink")}>{t.n}</div>
                    <div className="mt-2 h-4 text-[11px] font-light text-ink/50">
                      {"declined" in t && t.declined ? `${t.declined} declined` : "note" in t ? t.note : ""}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Money ────────────────────────────────────────────────────────────────────
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values) - 0.01;
  const hi = Math.max(...values) + 0.01;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - lo) / (hi - lo)) * 28}`).join(" ");
  return (
    <svg viewBox="0 0 100 32" className="mt-3 h-8 w-full" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="var(--seal-deep)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
function Money({ m }: { m: TodayMetrics }) {
  const tiles = [
    { k: "Accepted today", v: aed(m.money.acceptedToday), tone: "text-seal-deep", href: "/billing?tab=paid" },
    { k: "Held at risk", v: aed(m.money.atRisk), tone: m.money.atRisk ? "text-seal-amber" : "text-ink", href: "/billing" },
    { k: "Recovered this month", v: aed(m.money.recoveredMonth), tone: "text-ink", href: "/clinic" },
    { k: "Accepted the first time", v: pct(m.money.firstTime), tone: "text-ink", href: "/clinic", spark: m.money.trend },
  ];
  return (
    <section>
      <p className="eyebrow">The money</p>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.k} href={t.href} className="card group block p-6 transition-transform hover:-translate-y-0.5">
            <div className="flex items-start justify-between">
              <span className="text-[13px] font-light text-ink/60">{t.k}</span>
              <ArrowUpRight className="size-4 text-ink/30 transition-colors group-hover:text-ink" />
            </div>
            <div className={cn("dot mt-4 whitespace-nowrap text-[30px] leading-none sm:text-[34px]", t.tone)}>{t.v}</div>
            {t.spark && <Spark values={t.spark} />}
          </Link>
        ))}
      </div>
    </section>
  );
}

// ── Doctors today ────────────────────────────────────────────────────────────
function Doctors({ m }: { m: TodayMetrics }) {
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">Doctors today</p>
        <Link href="/emr" className="text-[13px] font-light text-ink/60 hover:text-ink">
          All patients →
        </Link>
      </div>
      <div className="-mx-4 mt-5 flex snap-x gap-4 overflow-x-auto px-4 pb-3 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 lg:grid-cols-4 xl:grid-cols-5">
        {m.doctors.map((d, i) => (
          <motion.div key={d.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, duration: 0.5 }} className="w-[230px] shrink-0 snap-start md:w-auto">
            <Link href={`/emr?providerId=${d.id}`} className="card group flex h-full flex-col p-5 transition-transform hover:-translate-y-0.5">
              <div className="flex items-center gap-3">
                <span className="relative flex size-12 shrink-0 items-center justify-center">
                  <span className="absolute inset-0 rounded-full bg-gradient-to-br from-white via-white/80 to-seal-mint/70 shadow-[inset_0_-6px_12px_rgba(31,43,41,0.06)] ring-1 ring-ink/10" />
                  <span className="relative text-[15px] font-light tracking-wide text-ink">{initials(d.name)}</span>
                  {d.stillWriting > 0 && <span className="heartbeat absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-[#f0b45a] ring-2 ring-white" title="In clinic now" />}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-normal">{d.name}</div>
                  <div className="truncate text-[12px] font-light capitalize text-ink/55">{d.specialty}</div>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 border-t border-ink/[0.07] pt-4 text-center">
                <div>
                  <div className="dot text-[24px] leading-none">{d.patientsToday}</div>
                  <div className="mt-1.5 text-[10.5px] font-light text-ink/55">patients</div>
                </div>
                <div>
                  <div className={cn("dot text-[24px] leading-none", d.openQuestions ? "text-seal-amber" : "text-ink/35")}>{d.openQuestions}</div>
                  <div className="mt-1.5 text-[10.5px] font-light text-ink/55">questions</div>
                </div>
                <div>
                  <div className="dot text-[24px] leading-none text-seal-deep">{pct(d.firstTime)}</div>
                  <div className="mt-1.5 text-[10.5px] font-light text-ink/55">first time</div>
                </div>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ── Needs you, insurers, learning ────────────────────────────────────────────
const KIND_ICON = { question: CircleHelp, claim: FileWarning, appeal: Gavel } as const;
function NeedsAndInsurers({ m }: { m: TodayMetrics }) {
  return (
    <section className="grid grid-cols-1 gap-8 lg:grid-cols-[1.25fr_1fr]">
      <div>
        <p className="eyebrow">Needs someone now</p>
        <div className="card mt-5 divide-y divide-ink/[0.06] !p-0">
          {m.needsYou.length === 0 && <p className="px-6 py-8 text-center text-[15px] font-light text-ink/60">Nothing is waiting. Every claim is moving.</p>}
          {m.needsYou.map((x, i) => {
            const Icon = KIND_ICON[x.kind];
            return (
              <Link key={i} href={x.href} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/50">
                <span className="dot w-6 text-[18px] text-ink/35">{i + 1}</span>
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full ring-1", x.kind === "appeal" ? "bg-[#c2473c]/10 text-[#c2473c] ring-[#c2473c]/20" : x.kind === "question" ? "bg-seal-amber/10 text-seal-amber ring-seal-amber/25" : "bg-white/70 text-ink ring-ink/10")}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-normal">{x.title}</div>
                  <div className="truncate text-[13px] font-light text-ink/55">{x.detail}</div>
                </div>
                {x.amount > 0 && <span className="dot hidden whitespace-nowrap text-[17px] sm:block">{aed(x.amount)}</span>}
                <span className="text-ink/30 transition-colors group-hover:text-ink">›</span>
              </Link>
            );
          })}
        </div>
      </div>
      <div className="space-y-8">
        <div>
          <p className="eyebrow">{m.hospital ? `Insurers · ${m.hospital.name}'s history` : "Insurers · last 90 days"}</p>
          <div className="card mt-5 space-y-4 p-6">
            {m.insurers.map((p) => (
              <div key={p.id}>
                <div className="flex items-baseline justify-between text-[14px]">
                  <span className="font-light">{p.name}</span>
                  <span className="dot text-[16px]">{pct(p.accepted)}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${p.accepted * 100}%` }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }} className="h-full rounded-full bg-gradient-to-r from-seal-mint to-seal-deep" />
                </div>
              </div>
            ))}
            <p className="text-[12px] font-light text-ink/45">Share of claims accepted on the first submission.</p>
          </div>
        </div>
        <Link href="/ai-health" className="card group flex items-center gap-5 p-6 transition-transform hover:-translate-y-0.5">
          <div className="relative h-14 w-28 shrink-0 overflow-hidden rounded-2xl bg-white/60 ring-1 ring-ink/10">
            <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-seal-mint to-seal-green/70" style={{ width: `${Math.max(6, Math.min(100, (m.learning.ready / 500) * 100))}%` }} />
            <div className="absolute inset-y-3 -right-1.5 w-1.5 rounded-r bg-ink/15" />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-normal">SEAL is learning</div>
            <div className="text-[13px] font-light text-ink/55">
              {m.learning.ready > 0 ? (
                <>
                  <span className="dot text-[16px] text-ink">{m.learning.ready.toLocaleString("en")}</span> new finished claims to learn from
                </>
              ) : (
                "Up to date with every finished claim"
              )}
            </div>
          </div>
          <ArrowUpRight className="ml-auto size-4 text-ink/30 group-hover:text-ink" />
        </Link>
      </div>
    </section>
  );
}
