"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Brain, Loader2, Sparkles, Zap } from "lucide-react";
import CountUp from "@/components/CountUp";
import ShinyText from "@/components/ShinyText";

type Step = { step: string; detail: Record<string, unknown> };
const FULL_AT = 500;

/**
 * The learning battery: finished claims flow in as outcomes; when SEAL learns, the battery drains
 * into new patterns. Level = outcomes since the last learning cycle (full at 500).
 */
export function LearningBattery({ ready, refused, learnedRules, onLearned }: { ready: number; refused: number; learnedRules: number; onLearned: () => void }) {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const level = running ? 0.04 : Math.max(0.06, Math.min(1, ready / FULL_AT));
  const proposals = steps.filter((s) => s.step === "proposal");
  const finished = steps.some((s) => s.step === "done");

  const teach = async () => {
    setRunning(true);
    setSteps([]);
    const res = await fetch("/api/learning/run", { method: "POST" });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const p of parts) if (p.trim()) setSteps((s) => [...s, JSON.parse(p)]);
    }
    setRunning(false);
    onLearned();
  };

  return (
    <section className="relative overflow-hidden rounded-[36px] bg-[#05070a] p-10 text-white">
      <div className="pointer-events-none absolute -left-24 top-0 size-[460px] rounded-full bg-seal-green/[0.14] blur-3xl" />
      <div className="relative grid grid-cols-[1fr_380px] items-center gap-12">
        <div>
          <div className="flex items-center gap-2 text-[14px] font-semibold tracking-[0.18em] text-seal-green">
            <Brain className="size-4" /> SEAL LEARNS FROM EVERY CLAIM
          </div>
          {/* Battery */}
          <div className="mt-6 flex items-center">
            <div className="relative h-[150px] flex-1 overflow-hidden rounded-[30px] bg-white/[0.04] ring-2 ring-white/15">
              <motion.div className="absolute inset-y-0 left-0 overflow-hidden" animate={{ width: `${level * 100}%` }} transition={{ duration: running ? 2.2 : 1.4, ease: [0.22, 1, 0.36, 1] }}>
                <div className="absolute inset-0 bg-gradient-to-r from-[#0f7a45] via-[#2fbf72] to-[#5df0a2] shadow-[0_0_60px_rgba(62,207,127,0.6)]" />
                {/* flowing wave on the leading edge */}
                <svg className="battery-wave absolute -right-[38px] top-0 h-full w-[80px]" viewBox="0 0 80 150" preserveAspectRatio="none">
                  <path d="M40 0 C 60 18, 20 37, 40 56 S 60 93, 40 112 S 20 140, 40 150 L 0 150 L 0 0 Z" fill="#5df0a2" />
                </svg>
                {Array.from({ length: 10 }).map((_, i) => (
                  <span key={i} className="battery-bubble absolute bottom-[-12px] rounded-full bg-white/50" style={{ left: `${(i * 37) % 95}%`, width: 6 + (i % 3) * 4, height: 6 + (i % 3) * 4, animationDelay: `${(i * 0.37) % 3}s`, animationDuration: `${2.6 + (i % 4) * 0.6}s` }} />
                ))}
                <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.25)_45%,transparent_60%)] bg-[length:200%_100%] [animation:battery-shine_3s_linear_infinite]" />
              </motion.div>
              <div className="relative flex h-full items-center px-8">
                <div>
                  <div className="display text-[64px] leading-none tabular-nums drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]">{running ? "…" : <CountUp to={ready} separator="," duration={1.4} trigger="load" />}</div>
                  <div className="mt-1 text-[16px] font-medium text-white/85">{running ? "SEAL is learning" : "finished claims ready to teach SEAL"}</div>
                </div>
              </div>
            </div>
            <div className="ml-1.5 h-[56px] w-[14px] rounded-r-xl bg-white/20" />
          </div>
          <div className="mt-5 flex gap-6 text-[15px] text-white/60">
            <span>
              <span className="font-semibold text-white">{refused.toLocaleString()}</span> of them were refused — the ones SEAL learns most from
            </span>
            <span>
              <span className="font-semibold text-white">{learnedRules}</span> pattern{learnedRules === 1 ? "" : "s"} learned and approved so far
            </span>
          </div>
        </div>

        <div className="rounded-[28px] bg-white/[0.05] p-7 ring-1 ring-white/10">
          <AnimatePresence mode="wait">
            {running || steps.length ? (
              <motion.div key="log" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3 text-[15px]">
                {running && <ShinyText text="Learning from the outcomes…" color="#3ecf7f" shineColor="#ffffff" speed={1.6} className="text-[17px] font-semibold" />}
                {steps.map((s, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2.5">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-seal-green" />
                    <span className="text-white/80">
                      {s.step === "outcomes" && `Read ${Number(s.detail.newOutcomes).toLocaleString()} finished claims`}
                      {s.step === "clusters" && (Number(s.detail.found) ? `Found ${s.detail.found} new refusal pattern${Number(s.detail.found) > 1 ? "s" : ""}` : "No new refusal patterns this time")}
                      {s.step === "proposal" && `New rule to review: “${String(s.detail.title)}”`}
                      {s.step === "proposal_failed" && "One pattern needs another look later"}
                      {s.step === "evaluation" && "Re-tested on 300 claims it has never seen"}
                      {s.step === "done" && "Done"}
                      {s.step === "error" && "Learning paused — try again in a minute"}
                    </span>
                  </motion.div>
                ))}
                {finished && proposals.length > 0 && (
                  <a href="/rules" className="mt-2 inline-flex rounded-full bg-seal-green px-4 py-2 text-[14px] font-semibold text-[#06120b]">
                    Review the new rule{proposals.length > 1 ? "s" : ""}
                  </a>
                )}
              </motion.div>
            ) : (
              <motion.div key="cta" initial={false} animate={{ opacity: 1 }}>
                <div className="display text-[26px] leading-tight">Every paid and refused claim makes the next check smarter.</div>
                <p className="mt-3 text-[15px] text-white/55">SEAL looks for new refusal patterns, proposes rules for a person to approve, and re-tests itself.</p>
              </motion.div>
            )}
          </AnimatePresence>
          <button onClick={teach} disabled={running} className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-seal-green py-4 text-[17px] font-semibold text-[#06120b] shadow-[0_0_40px_-8px_rgba(62,207,127,0.8)] transition-transform hover:scale-[1.02] disabled:opacity-60">
            {running ? <Loader2 className="size-5 animate-spin" /> : <Zap className="size-5" />} {running ? "Learning…" : "Teach SEAL now"}
          </button>
        </div>
      </div>
    </section>
  );
}
