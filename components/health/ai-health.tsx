"use client";

import { SealLoader } from "@/components/brand/seal-loader";
import { useEffect, useState } from "react";
import { AlertTriangle, Brain, Clock, Lock, MessageCircleQuestion, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import CountUp from "@/components/CountUp";
import SpotlightCard from "@/components/SpotlightCard";
import { LearningBattery } from "./battery";
import { cn } from "@/lib/utils";

type Op = { agent: string; calls: number; p50: number | null; fallbackRate: number | null };
type H = {
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
export function AiHealth() {
  const [h, setH] = useState<H | null>(null);
  const reload = () => fetch("/api/ai-health").then((r) => r.json()).then(setH).catch(() => {});
  useEffect(() => {
    const load = reload;
    void load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, []);
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
      <h1 className="display mt-1 text-[34px] md:text-[44px] lg:text-[52px] leading-tight">How SEAL is helping Seabreeze</h1>
      <p className="mt-3 max-w-2xl text-[19px] text-muted-foreground">Measured on claims the insurer has already decided, so every number here is checked against what really happened.</p>

      {critical.map((a) => (
        <div key={a.text} className="mt-6 flex items-center gap-3 rounded-3xl bg-risk-high/[0.06] px-4 md:px-6 py-4 text-[16px]">
          <AlertTriangle className="size-5 text-risk-high" /> {a.text}
        </div>
      ))}

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
        <div className="display mt-6 text-[52px] md:text-[76px] leading-none tabular-nums">
          <CountUp to={value} duration={1.2} trigger="load" />
          <span className="text-[34px] text-muted-foreground">{suffix}</span>
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
