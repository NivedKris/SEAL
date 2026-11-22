"use client";

import { SealLoader } from "@/components/brand/seal-loader";

import { useData } from "@/lib/client/data";
import { AlertTriangle, Brain, Clock, Lock, MessageCircleQuestion, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import CountUp from "@/components/CountUp";
import SpotlightCard from "@/components/SpotlightCard";
import { LearningBattery } from "./battery";
import { cn } from "@/lib/utils";

type Op = { agent: string; calls: number; p50: number | null; fallbackRate: number | null };
type H = {
  hospital: {
    name: string;
    claims: number;
    clinicians: number;
    insurers: number;
    firstTime: number;
    medicalNecessityShare: number | null;
    resubmissionRecovers: number;
    toughest: { insurer: string; refusedClaimsRate: number } | null;
    deployment: { where: string; model: string; tuning: string; data: string[]; users: string[]; demoNote: string } | null;
  } | null;
  learning: { readyCases: number; refusedReady: number; learnedRules: number };
  calls: number;
  operations: Op[];
  safety: { maskingChecks: number; maskingPassed: number; guardrailBlocks: Record<string, number> };
  agreement: { doctorQuestionSets: number; doctorAnswered: number; doctorMinutesToAnswerMedian: number | null; billerAccepted: number; billerOverrides: number };
  quality: { eval: { holdPrecision: number; refusalRecall: number; firstPassBaseline?: number; firstPassWithSeal?: number } | null; live: { n: number } };
  versions: { activeRules: number; lastLearningCycle: string | null };
  alerts: { level: "critical" | "warning"; text: string }[];
};

/** Insights for the people who use SEAL every day: what it is doing for the hospital, in plain words. */
export function AiHealth({ initial }: { initial?: Promise<H | null> }) {
  const { data, reload } = useData<H>("/api/ai-health", { initial, refreshMs: 20_000 });
  const h = data ?? null;
  if (!h) return <SealLoader className="min-h-[70vh]" size={44} />;

  const q = h.quality.eval;
  const pct = (x?: number | null) => Math.round((x ?? 0) * 100);
  const judge = h.operations.find((o) => o.agent === "claimJudge") ?? h.operations.find((o) => o.agent === "orderJustification");
  const seconds = judge?.p50 ? Math.max(1, Math.round(judge.p50 / 1000)) : null;
  const totalCalls = h.operations.reduce((s, o) => s + o.calls, 0);
  const backupShare = totalCalls ? h.operations.reduce((s, o) => s + (o.fallbackRate ?? 0) * o.calls, 0) / totalCalls : 0;
  const blocked = Object.values(h.safety.guardrailBlocks).reduce((s, n) => s + n, 0);
  const critical = h.alerts.filter((a) => a.level === "critical");

  return (
    <main className="mx-auto max-w-[1200px] px-4 md:px-6 pb-24 pt-12">
      <p className="text-[17px] font-medium text-muted-foreground">Insights</p>
      <h1 className="display mt-1 text-[34px] md:text-[44px] lg:text-[52px] leading-tight">How SEAL is helping {h.hospital?.name ?? "Seabreeze"}</h1>
      <p className="mt-3 max-w-2xl text-[19px] text-muted-foreground">Measured on claims the insurer has already decided, so every number here is checked against what really happened.</p>

      {critical.map((a) => (
        <div key={a.text} className="mt-6 flex items-center gap-3 rounded-3xl bg-risk-high/[0.06] px-4 md:px-6 py-4 text-[16px]">
          <AlertTriangle className="size-5 text-risk-high" /> {a.text}
        </div>
      ))}

      {h.hospital && <HospitalLearned h={h.hospital} />}
      {h.hospital?.deployment && <Deployment name={h.hospital.name} d={h.hospital.deployment} />}

      <div className="mt-10">
        <LearningBattery ready={h.learning.readyCases} refused={h.learning.refusedReady} learnedRules={h.learning.learnedRules} onLearned={() => void reload()} />
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
        <Big
          icon={<ShieldCheck className="size-6" />}
          value={pct(q?.refusalRecall)}
          suffix=" of 100"
          title="refused claims SEAL would have stopped"
          body="Caught before sending, with the fix, instead of coming back weeks later as a refusal."
          tone="green"
        />
        <Big icon={<TrendingUp className="size-6" />} value={pct(q?.firstPassWithSeal)} suffix="%" title={`of claims paid the first time, up from ${pct(q?.firstPassBaseline)}%`} body="When the claims SEAL holds are fixed before they go." tone="blue" />
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <Small icon={<Sparkles className="size-5" />} title="When SEAL holds a claim" line={`it is right ${pct(q?.holdPrecision)} times in 100`} />
        <Small icon={<Clock className="size-5" />} title="Each claim is checked in" line={seconds ? `about ${seconds} second${seconds > 1 ? "s" : ""}` : "a few seconds"} />
        <Small
          icon={<MessageCircleQuestion className="size-5" />}
          title="Doctors answered"
          line={h.agreement.doctorQuestionSets ? `${h.agreement.doctorAnswered} of ${h.agreement.doctorQuestionSets} question sets${h.agreement.doctorMinutesToAnswerMedian != null ? `, usually within ${Math.max(1, Math.round(h.agreement.doctorMinutesToAnswerMedian))} min` : ""}` : "no questions asked yet"}
        />
        <Small icon={<Lock className="size-5" />} title="Patient details stay private" line={h.safety.maskingChecks ? `names and IDs removed from all ${h.safety.maskingPassed.toLocaleString()} AI requests` : "names and IDs are removed before any AI request"} />
        <Small icon={<Brain className="size-5" />} title="SEAL keeps learning" line={`${h.versions.activeRules} insurer rules on every claim${h.versions.lastLearningCycle ? ` · updated ${new Date(h.versions.lastLearningCycle).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}`} />
        <Small
          icon={<ShieldCheck className="size-5" />}
          title="Safety checks"
          line={blocked ? `${blocked} AI suggestion${blocked > 1 ? "s" : ""} stopped for not matching the note` : "every AI answer matched the note"}
        />
      </div>

      <div className={cn("mt-5 flex items-center gap-3 rounded-3xl px-4 md:px-6 py-4 text-[15px]", backupShare > 0.1 ? "bg-risk-mid/[0.08]" : "bg-seal-green/[0.08]")}>
        <span className={cn("size-2.5 rounded-full", backupShare > 0.1 ? "bg-risk-mid" : "bg-seal-green")} />
        {backupShare > 0.1 ? "The AI service is busy; SEAL is using its backup, so some checks take longer." : "The AI service is running normally."}
      </div>
    </main>
  );
}

function Big({ icon, value, suffix, title, body, tone }: { icon: React.ReactNode; value: number; suffix: string; title: string; body: string; tone: "green" | "blue" }) {
  return (
    <div className="rise">
      <SpotlightCard theme="light" spotlightColor={tone === "green" ? "rgba(62,207,127,0.25)" : "rgba(42,120,214,0.2)"} className="card h-full !rounded-[32px] p-5 md:p-9">
        <span className={cn("flex size-12 items-center justify-center rounded-2xl", tone === "green" ? "bg-seal-green/15 text-[#178a4c]" : "bg-[#2a78d6]/10 text-[#2a78d6]")}>{icon}</span>
        <div className="dot mt-6 text-[56px] md:text-[80px] leading-none">
          <CountUp to={value} duration={1.2} trigger="load" />
          <span className="font-sans text-[30px] font-semibold text-muted-foreground">{suffix}</span>
        </div>
        <div className="mt-3 text-[22px] font-semibold leading-snug">{title}</div>
        <p className="mt-2 text-[16px] text-muted-foreground">{body}</p>
      </SpotlightCard>
    </div>
  );
}

function Small({ icon, title, line }: { icon: React.ReactNode; title: string; line: string }) {
  return (
    <div className="card p-7">
      <span className="flex size-10 items-center justify-center rounded-xl bg-black/[0.04]">{icon}</span>
      <div className="mt-5 text-[15px] text-muted-foreground">{title}</div>
      <div className="mt-1 text-[21px] font-semibold leading-snug">{line}</div>
    </div>
  );
}

/** What SEAL learned from this hospital's own claims (hospitals with their own history). */
function HospitalLearned({ h }: { h: NonNullable<H["hospital"]> }) {
  const facts = [
    { k: "Paid in full the first time", v: `${Math.round(h.firstTime * 100)}%` },
    h.medicalNecessityShare != null ? { k: "Of refused money is medical necessity", v: `${Math.round(h.medicalNecessityShare * 100)}%` } : null,
    { k: "Won back by resubmitting", v: `${Math.round(h.resubmissionRecovers * 100)}%` },
    h.toughest ? { k: `Refused by ${h.toughest.insurer}`, v: `${Math.round(h.toughest.refusedClaimsRate * 100)}%` } : null,
  ].filter(Boolean) as { k: string; v: string }[];
  return (
    <section className="card mt-10 p-6 md:p-9">
      <p className="eyebrow">Tuned for {h.name}</p>
      <h2 className="display mt-3 text-[30px] leading-tight md:text-[40px]">
        SEAL learned from <span className="dot text-seal-deep">{h.claims.toLocaleString("en")}</span> of {h.name}&apos;s own claims.
      </h2>
      <p className="mt-3 max-w-2xl text-[16px] font-light text-ink/65">
        {h.clinicians} clinicians and {h.insurers} insurers. On top of the public rules and the regional claim memory every hospital shares, SEAL now knows how each insurer treats this hospital, and adjusts every claim&apos;s risk to match.
      </p>
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {facts.map((f) => (
          <div key={f.k} className="rounded-2xl bg-white/55 p-5 ring-1 ring-ink/[0.06]">
            <div className="dot text-[36px] leading-none">{f.v}</div>
            <div className="mt-3 text-[13px] font-light text-ink/60">{f.k}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** How SEAL is deployed at this hospital: where it sits, which AI, what it learned from, who uses it. */
function Deployment({ name, d }: { name: string; d: NonNullable<NonNullable<H["hospital"]>["deployment"]> }) {
  return (
    <section className="card mt-8 overflow-hidden p-6 md:p-9">
      <p className="eyebrow">Deployment</p>
      <h2 className="display mt-3 text-[28px] leading-tight md:text-[36px]">How SEAL is deployed at {name}</h2>

      {/* where it sits */}
      <div className="mt-8 grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto_1.3fr_auto_1fr]">
        <Node title={`${name} HMS`} sub="Patient visits, doctors' notes, orders" />
        <Flow />
        <div className="relative rounded-[24px] bg-gradient-to-br from-white to-seal-mint/60 p-5 text-center ring-2 ring-seal-deep/30">
          <div className="text-[18px] font-semibold tracking-tight">SEAL</div>
          <div className="mt-1 text-[12px] font-light text-ink/65">On-premises · checks every order and claim</div>
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {d.users.map((u) => (
              <span key={u} className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-light ring-1 ring-ink/[0.08]">
                {u}
              </span>
            ))}
          </div>
        </div>
        <Flow />
        <Node title="DHPO · insurers" sub="Claims out, payments and refusals back" />
      </div>
      <p className="mt-4 text-center text-[13px] font-light text-ink/60">{d.where}</p>

      <div className="mt-9 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Fact k="The AI" v={d.model} />
        <Fact k="How it learns" v={d.tuning} />
        <div className="rounded-2xl bg-white/55 p-5 ring-1 ring-ink/[0.06]">
          <div className="eyebrow !text-[10px]">Trained on</div>
          <ul className="mt-2 space-y-1.5 text-[14px] font-light leading-snug text-ink/80">
            {d.data.map((x) => (
              <li key={x} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-seal-deep" />
                {x}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-6 text-[12px] font-light text-ink/45">{d.demoNote}</p>
    </section>
  );
}
function Node({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="rounded-[22px] bg-white/60 p-5 text-center ring-1 ring-ink/[0.07]">
      <div className="text-[15px] font-normal">{title}</div>
      <div className="mt-1 text-[12px] font-light text-ink/55">{sub}</div>
    </div>
  );
}
function Flow() {
  return (
    <div className="flex justify-center md:block" aria-hidden>
      <svg width="64" height="18" viewBox="0 0 64 18" className="rotate-90 md:rotate-0">
        <line x1="2" y1="9" x2="62" y2="9" stroke="rgba(31,43,41,0.25)" strokeWidth="1.5" />
        <line x1="2" y1="9" x2="62" y2="9" stroke="#2f9e62" strokeWidth="2" className="thread-flow" />
        <path d="M54 3 L62 9 L54 15" fill="none" stroke="rgba(31,43,41,0.35)" strokeWidth="1.5" />
      </svg>
    </div>
  );
}
function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-2xl bg-white/55 p-5 ring-1 ring-ink/[0.06]">
      <div className="eyebrow !text-[10px]">{k}</div>
      <p className="mt-2 text-[14px] font-light leading-snug text-ink/80">{v}</p>
    </div>
  );
}
