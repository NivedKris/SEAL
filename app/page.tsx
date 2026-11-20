"use client";

import Link from "next/link";
import { ArrowRight, Check, ClipboardList, MessageCircleQuestion, Stethoscope, TrendingUp } from "lucide-react";
import LightRays from "@/components/LightRays";
import Particles from "@/components/Particles";
import DotGrid from "@/components/DotGrid";
import Threads from "@/components/Threads";
import CountUp from "@/components/CountUp";
import RotatingText from "@/components/RotatingText";
import GradientText from "@/components/GradientText";
import DecryptedText from "@/components/DecryptedText";
import SpotlightCard from "@/components/SpotlightCard";
import FadeContent from "@/components/FadeContent";
import { SealLogo } from "@/components/brand/seal-logo";
import { HospitalLoop } from "@/components/marketing/hospital-loop";

const GREEN = "#3ecf7f";

/** Landing: the story of a claim, told top to bottom. Black and green, serif headings. */
export default function Home() {
  return (
    <main className="relative bg-[#05070a] text-white">
      {/* ── Hero ── */}
      <section className="relative flex min-h-[92vh] items-center overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <LightRays raysOrigin="top-center" raysColor={GREEN} raysSpeed={0.8} lightSpread={0.9} rayLength={1.6} fadeDistance={1.1} />
        </div>
        <div className="absolute inset-0 opacity-60">
          <Particles particleCount={160} particleSpread={12} speed={0.08} particleColors={["#3ecf7f", "#ffffff", "#9ef0c4"]} moveParticlesOnHover alphaParticles particleBaseSize={70} disableRotation={false} />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-b from-transparent to-[#05070a]" />
        <div className="relative mx-auto w-full max-w-[1200px] px-4 md:px-6">
          <DecryptedText text="FOR UAE HOSPITALS · BUILT FOR DHA eCLAIMLINK" animateOn="view" sequential speed={35} revealDirection="start" className="text-seal-green" encryptedClassName="text-seal-green/40" parentClassName="text-[13px] font-semibold tracking-[0.22em]" />
          <h1 className="display mt-6 max-w-5xl text-[50px] sm:text-[72px] lg:text-[100px] leading-[0.98]">
            Get paid{" "}
            <GradientText colors={["#3ecf7f", "#b6f7d3", "#2fbf72", "#3ecf7f"]} animationSpeed={6}>
              the first time.
            </GradientText>
          </h1>
          <div className="rise rise-1 mt-6 flex flex-wrap items-baseline gap-x-3 text-[30px] font-medium text-white/85">
            <span>SEAL catches the refusal before</span>
            <RotatingText
              texts={["the doctor signs.", "the claim is sent.", "the insurer says no."]}
              rotationInterval={2600}
              staggerDuration={0.02}
              effect="blur"
              className="rounded-2xl bg-seal-green px-4 py-1 font-semibold text-[#06120b]"
            />
          </div>
          <p className="rise rise-2 mt-8 max-w-2xl text-[20px] leading-relaxed text-white/60">
            It reads the doctor&apos;s note against every insurer rule while it&apos;s being written, and fixes the claim before anyone presses send.
          </p>
          <div className="rise rise-3 mt-10 flex flex-wrap items-center gap-3 sm:gap-4">
            <Link href="/emr" className="inline-flex items-center gap-2.5 rounded-full bg-seal-green px-5 md:px-7 py-4 text-[17px] font-semibold text-[#06120b] shadow-[0_0_40px_-8px_rgba(62,207,127,0.7)] transition-transform hover:scale-[1.03]">
              Start your day <ArrowRight className="size-5" />
            </Link>
            <a href="#story" className="rounded-full px-4 md:px-6 py-4 text-[17px] font-medium text-white/70 ring-1 ring-white/15 backdrop-blur transition-colors hover:text-white hover:ring-white/30">
              Watch a claim get checked
            </a>
          </div>
          <div className="rise rise-3 mt-14 flex flex-wrap gap-x-10 gap-y-3 text-[15px] text-white/55">
            {["Checks every order in under a second", "English and Arabic", "Never changes a code or adds a diagnosis"].map((t) => (
              <span key={t} className="flex items-center gap-2">
                <Check className="size-4 text-seal-green" /> {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── The problem ── */}
      <section id="story" className="relative overflow-hidden">
        <div className="absolute inset-0 opacity-50">
          <DotGrid dotSize={3} gap={28} baseColor="#16251d" activeColor={GREEN} proximity={140} />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_50%,transparent,#05070a)]" />
        <div className="relative mx-auto max-w-[1200px] px-4 md:px-6 py-28">
          <FadeContent effect="focus" trigger="scroll">
            <p className="text-[14px] font-semibold tracking-[0.2em] text-[#e8a33d]">THE PROBLEM</p>
            <h2 className="display mt-4 max-w-3xl text-[36px] md:text-[48px] lg:text-[60px] leading-[1.05]">
              Most refusals are decided <span className="text-seal-green">the moment a test is ordered.</span>
            </h2>
          </FadeContent>
          <div className="mt-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-10">
            <Stat value={8.6} decimals={1} suffix="%+" tone="#ff6b5b" label="of test claims disputed, in a UAE study of 598,000 claims" source="AccuMed via Gulf News" />
            <Stat value={12} prefix="2 to " label="tests ordered for one diabetes diagnosis, in the same study" source="AccuMed via Gulf News" />
            <Stat value={47.3} decimals={1} suffix="%" tone={GREEN} label="of refused claims trace back to documentation" source="Risk Manag Healthc Policy, 2026" />
          </div>
        </div>
      </section>

      {/* ── At the order ── */}
      <section className="relative overflow-hidden py-28">
        <div className="pointer-events-none absolute left-1/2 top-1/3 size-[700px] -translate-x-1/2 rounded-full bg-seal-green/[0.08] blur-3xl" />
        <div className="relative mx-auto grid max-w-[1200px] grid-cols-1 lg:grid-cols-[1.35fr_1fr] items-center gap-6 lg:gap-14 px-4 md:px-6">
          <FadeContent effect="focus" trigger="scroll">
            <div className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0"><div className="min-w-[620px]"><EmrMock /></div></div>
          </FadeContent>
          <div>
            <h2 className="display text-[34px] md:text-[44px] lg:text-[54px] leading-[1.05]">So SEAL sits beside the order, not after the claim.</h2>
            <p className="mt-6 text-[19px] leading-relaxed text-white/60">Every test and scan is read against the complaint, the findings and the insurer&apos;s own rule — in under a second, while the doctor is still typing.</p>
            <div className="mt-8 rounded-3xl bg-seal-green/[0.04] p-6 ring-1 ring-seal-green/40">
              <div className="display text-[24px] text-seal-green">The doctor decides.</div>
              <p className="mt-2 text-[16px] leading-relaxed text-white/65">SEAL shows what the insurer will ask, and the rule it comes from. It never removes a test or adds a diagnosis.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Three people ── */}
      <section className="mx-auto max-w-[1200px] px-4 md:px-6 py-28">
        <p className="text-[14px] font-semibold tracking-[0.2em] text-[#e8a33d]">THE PRODUCT</p>
        <h2 className="display mt-4 text-[36px] md:text-[48px] lg:text-[60px] leading-[1.05]">
          One product. Three people. <span className="text-seal-green">Here&apos;s what each one sees.</span>
        </h2>
        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Person href="/billing" icon={<ClipboardList className="size-5" />} who="Noura · Billing" what="The claim, before it goes." body="Every claim checked the moment it exists, with the exact fix — and refused ones drafted back for her to approve.">
            <MiniClaim />
          </Person>
          <Person href="/doctor" icon={<MessageCircleQuestion className="size-5" />} who="Dr. Omar · Doctor" what="Answers on the phone, in seconds." body="Only the questions the insurer will ask. In his own words, in English or Arabic.">
            <MiniPhone />
          </Person>
          <Person href="/clinic" icon={<TrendingUp className="size-5" />} who="Khalid · Owner" what="The money coming back." body="First-time payment, cash at risk, cash recovered — every number from real claim outcomes.">
            <MiniMoney />
          </Person>
        </div>
      </section>

      {/* ── The doctor ── */}
      <section className="relative overflow-hidden py-28">
        <div className="absolute inset-0 opacity-70">
          <Threads color={GREEN} amplitude={1.2} distance={0.2} enableMouseInteraction />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#05070a] via-[#05070a]/70 to-transparent" />
        <div className="relative mx-auto grid max-w-[1200px] grid-cols-1 lg:grid-cols-[1fr_1fr] items-center gap-6 lg:gap-16 px-4 md:px-6">
          <div>
            <Stethoscope className="size-8 text-seal-green" />
            <h2 className="display mt-6 text-[36px] md:text-[46px] lg:text-[58px] leading-[1.05]">Built around the doctor, not the form.</h2>
            <ul className="mt-8 space-y-4 text-[19px] text-white/75">
              {["Risks appear beside the order, while the note is open", "Fill a blank in a sentence — SEAL never writes for you", "Questions only when a claim truly needs them: 3, 1 or none", "Your answers become a signed addendum, word for word"].map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-seal-green/15 text-seal-green">
                    <Check className="size-4" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
            <Link href="/emr" className="mt-10 inline-flex items-center gap-2 text-[17px] font-semibold text-seal-green">
              Open today&apos;s clinic <ArrowRight className="size-5" />
            </Link>
          </div>
          <FadeContent effect="focus" trigger="scroll">
            <DoctorCard />
          </FadeContent>
        </div>
      </section>

      {/* ── Hospitals ── */}
      <section className="border-y border-white/[0.06] py-16">
        <p className="mb-8 text-center text-[13px] font-semibold tracking-[0.2em] text-white/40">HOSPITALS ON SEAL</p>
        <HospitalLoop dark />
      </section>

      {/* ── Footer ── */}
      <footer className="mx-auto flex max-w-[1200px] flex-col items-center gap-3 px-4 py-12 text-center text-[14px] text-white/45 md:flex-row md:justify-between md:px-6 md:text-left">
        <span className="text-white">
          <SealLogo height={22} />
        </span>
        <span>© {new Date().getFullYear()} SEAL. All rights reserved.</span>
        <span>Dubai · Built for DHA eClaimLink</span>
      </footer>
    </main>
  );
}

function Stat({ value, label, source, prefix = "", suffix = "", decimals = 0, tone = "#ffffff" }: { value: number; label: string; source: string; prefix?: string; suffix?: string; decimals?: number; tone?: string }) {
  return (
    <div className="border-t border-white/10 pt-6">
      <div className="display text-[48px] md:text-[72px] leading-none" style={{ color: tone }}>
        {prefix}
        <CountUp to={value} decimals={decimals} duration={1.6} />
        {suffix}
      </div>
      <p className="mt-4 text-[18px] leading-snug text-white/75">{label}</p>
      <p className="mt-2 text-[13px] text-white/35">{source}</p>
    </div>
  );
}

function EmrMock() {
  const rows: [string, string, string, string, string][] = [
    ["HbA1c", "83036", "Done 6 weeks ago", "Insurer pays once every 3 months", "risk"],
    ["Lipid panel", "80061", "OK", "", "ok"],
    ["Vitamin D, 25-OH", "82306", "No qualifying diagnosis", "Covered only for listed conditions", "risk"],
    ["MRI, lumbar spine", "72148", "Needs a specialist request", "Elective MRI from a GP clinic", "warn"],
    ["CBC", "85025", "OK", "", "ok"],
  ];
  return (
    <div className="overflow-hidden rounded-[22px] bg-white text-[#111] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/10">
      <div className="flex items-center gap-6 bg-[#0f1a2b] px-5 py-3 text-[13px] text-white/80">
        <span className="font-semibold text-white">EMR</span>
        <span className="text-white">Orders</span>
        <span>Notes</span>
        <span>Results</span>
        <span className="ml-auto rounded-full bg-[#ffe1dc] px-3 py-1 text-[12px] font-semibold text-[#c0392b]">SEAL · 3 risks found</span>
      </div>
      <div className="grid grid-cols-[1fr_1.4fr_1.4fr] gap-4 border-b border-black/[0.06] px-5 py-3 text-[12px]">
        <div>
          <div className="font-semibold">R.K. · Male · 52</div>
          <div className="text-black/50">Insurer A · Enhanced plan</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold tracking-wider text-black/40">COMPLAINT</div>
          Tired for 2 weeks. Lower back pain for 1 week.
        </div>
        <div>
          <div className="text-[10px] font-semibold tracking-wider text-black/40">DIAGNOSIS</div>
          E11.9 Type 2 diabetes · M54.50 Low back pain
        </div>
      </div>
      {rows.map(([name, code, msg, sub, k]) => (
        <div key={code} className="grid grid-cols-[1.1fr_70px_1.6fr_auto] items-center gap-3 border-b border-black/[0.05] px-5 py-3 text-[13px]" style={{ borderLeft: `4px solid ${k === "risk" ? "#e5533d" : k === "warn" ? "#e8a33d" : "transparent"}`, background: k === "risk" ? "#fff6f4" : k === "warn" ? "#fffaf1" : undefined }}>
          <span className="font-semibold">{name}</span>
          <span className="text-black/45">{code}</span>
          <span>
            <span className={k === "ok" ? "font-semibold text-[#178a4c]" : k === "warn" ? "font-semibold text-[#b8741a]" : "font-semibold text-[#c0392b]"}>{msg}</span>
            {sub && <span className="block text-[11px] text-black/45">{sub}</span>}
          </span>
          <span className="flex gap-1.5">
            {k !== "ok" && (
              <>
                <span className="rounded-md bg-black/[0.05] px-2.5 py-1 text-[11px] font-semibold">{k === "warn" ? "Refer" : "Remove"}</span>
                <span className="rounded-md bg-[#178a4c] px-2.5 py-1 text-[11px] font-semibold text-white">Add reason</span>
              </>
            )}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between bg-[#fbf7ee] px-5 py-3 text-[13px]">
        <span>
          <span className="font-semibold">3 of 5 orders</span> likely to be refused · <span className="font-semibold text-[#c0392b]">AED 1,940 at risk</span>
        </span>
        <span className="rounded-lg bg-[#0f1a2b] px-4 py-1.5 text-[12px] font-semibold text-white">Sign orders</span>
      </div>
    </div>
  );
}

function Person({ href, icon, who, what, body, children }: { href: string; icon: React.ReactNode; who: string; what: string; body: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="group">
      <SpotlightCard theme="dark" spotlightColor="rgba(62, 207, 127, 0.25)" className="h-full rounded-[28px] bg-white/[0.04] p-7 ring-1 ring-white/10 transition-transform duration-300 group-hover:-translate-y-1">
        <div className="flex items-center gap-2 text-[13px] font-semibold tracking-[0.12em] text-[#e8a33d]">
          {icon} {who.toUpperCase()}
        </div>
        <div className="display mt-3 text-[28px] leading-tight">{what}</div>
        <p className="mt-3 text-[15px] leading-relaxed text-white/55">{body}</p>
        <div className="mt-6">{children}</div>
        <div className="mt-6 flex items-center gap-2 text-[15px] font-semibold text-seal-green">
          Open <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </div>
      </SpotlightCard>
    </Link>
  );
}

function MiniClaim() {
  return (
    <div className="rounded-2xl bg-white p-4 text-[#111]">
      <div className="text-[11px] font-semibold tracking-wider text-black/40">WILL BE REFUSED</div>
      <div className="display mt-1 text-[19px] text-[#c0392b]">Symptom duration missing</div>
      <div className="mt-2 rounded-lg bg-black/[0.04] px-3 py-2 font-mono text-[11px]">
        Pt c/o lower back pain. Plan: MRI. <span className="bg-[#ffe1dc] text-[#c0392b]">Duration? Prior treatment?</span>
      </div>
      <div className="mt-3 flex gap-2 text-[11px] font-semibold">
        <span className="rounded-md bg-[#178a4c] px-3 py-1 text-white">Fix</span>
        <span className="rounded-md bg-black/[0.05] px-3 py-1">Send</span>
      </div>
    </div>
  );
}

function MiniPhone() {
  return (
    <div className="mx-auto w-[210px] rounded-[30px] bg-black p-2 ring-1 ring-white/15">
      <div className="rounded-[24px] bg-white p-4 text-[#111]">
        <div className="text-[10px] font-semibold text-[#178a4c]">2 QUESTIONS · ~30 SEC</div>
        <div className="display mt-1 text-[15px] leading-snug">The insurer needs two details your note doesn&apos;t include.</div>
        <div className="mt-2 rounded-lg bg-black/[0.04] px-2.5 py-1.5 text-[10px] text-black/50">How long have the symptoms lasted?</div>
        <div className="mt-1.5 text-right text-[10px] text-black/50" dir="rtl">
          مدة الأعراض؟ ما العلاج الذي جُرّب أولاً؟
        </div>
        <div className="mt-2 rounded-lg bg-[#178a4c] py-1.5 text-center text-[11px] font-semibold text-white">Send</div>
      </div>
    </div>
  );
}

function MiniMoney() {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white p-3 text-[#111]">
      {[
        ["Refused first time", "18% → 11%"],
        ["Recovered", "AED 630k"],
        ["Cash at risk", "AED 1.2 m"],
        ["Deadlines missed", "0"],
      ].map(([k, v]) => (
        <div key={k} className="rounded-xl bg-black/[0.035] p-2.5">
          <div className="text-[10px] text-black/45">{k}</div>
          <div className="display text-[17px] text-[#178a4c]">{v}</div>
        </div>
      ))}
    </div>
  );
}

function DoctorCard() {
  return (
    <div className="relative mx-auto w-full max-w-[360px] rounded-[48px] bg-black p-3 shadow-[0_40px_120px_-30px_rgba(62,207,127,0.45)] ring-1 ring-white/15">
      <div className="rounded-[38px] bg-white px-4 md:px-6 pb-7 pt-9 text-[#111]">
        <div className="flex items-center justify-between">
          <SealLogo height={18} />
          <span className="text-[12px] text-black/45">1 of 2</span>
        </div>
        <div className="mt-5 inline-flex rounded-full bg-black/[0.05] px-3 py-1 font-mono text-[11px]">72148 MRI lumbar spine</div>
        <div className="display mt-3 text-[24px] leading-snug">How long has the back pain lasted, and what neurologic finding did you see?</div>
        <div className="mt-1.5 text-[13px] text-black/45" dir="rtl">
          منذ متى بدأ ألم الظهر، وما الموجودات العصبية التي وجدتها؟
        </div>
        <div className="mt-5 flex gap-2">
          <div className="flex-1 rounded-xl px-3 py-2.5 text-[15px] ring-1 ring-black/10">8</div>
          {["days", "weeks", "months"].map((u) => (
            <span key={u} className={`rounded-full px-3 py-2.5 text-[13px] ${u ==="weeks" ? "bg-[#111] text-white" : "bg-black/[0.05]"}`}>
              {u}
            </span>
          ))}
        </div>
        <div className="mt-3 rounded-xl px-3 py-2.5 text-[14px] ring-1 ring-black/10">Absent left ankle reflex, SLR positive at 40°</div>
        <div className="mt-5 rounded-full bg-[#178a4c] py-3 text-center text-[15px] font-semibold text-white">Next</div>
      </div>
    </div>
  );
}
