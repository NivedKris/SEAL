"use client";

import { useEffect } from "react";
import { motion } from "motion/react";
import { autoStart } from "@/components/landing/sound";
import { SoundToggle } from "@/components/landing/sound-toggle";
import { ArrowRight, Check } from "lucide-react";
import { SealLogo } from "@/components/brand/seal-logo";
import { TENANTS, type Tenant } from "@/lib/tenant";
import { cn } from "@/lib/utils";

/** "Open SEAL": choose a hospital. Two large cards; each opens that hospital's SEAL. */
export function HospitalPicker() {
  const list = [TENANTS.basic, TENANTS.apollo];
  // Keep the soundtrack going from the landing (or start it, if someone comes here directly).
  useEffect(() => void autoStart(), []);
  return (
    <main className="relative min-h-[100svh] overflow-hidden px-5 pb-16 pt-28 md:px-10">
      <SoundToggle className="fixed bottom-6 right-5 z-30 md:right-8" />
      <div className="pointer-events-none absolute -left-40 top-10 size-[620px] rounded-full bg-[#fff6e6]/80 blur-3xl" />
      <div className="pointer-events-none absolute -right-40 bottom-0 size-[620px] rounded-full bg-seal-mint/40 blur-3xl" />
      <div className="relative mx-auto max-w-[1180px]">
        <motion.div initial={{ opacity: 0, y: 12, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} className="text-center">
          <p className="eyebrow">Open SEAL</p>
          <h1 className="display mt-4 text-[40px] leading-[1.05] sm:text-[56px]">Choose your hospital.</h1>
          <p className="mx-auto mt-4 max-w-xl text-[17px] font-light text-ink/65">Every hospital starts with SEAL Basic. A hospital that shares its claim history gets a SEAL tuned to it.</p>
        </motion.div>
        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
          {list.map((t, i) => (
            <Card key={t.id} t={t} i={i} />
          ))}
        </div>
      </div>
    </main>
  );
}

function Card({ t, i }: { t: Tenant; i: number }) {
  const tuned = !!t.logo;
  return (
    <motion.a
      href={`/t/${t.id}`}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + i * 0.12, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -6 }}
      className={cn("card group relative flex min-h-[520px] flex-col overflow-hidden !rounded-[36px] p-8 transition-shadow md:p-10", tuned ? "hover:shadow-[0_0_0_1px_rgba(0,140,190,0.25),0_40px_80px_-30px_rgba(0,110,160,0.35)]" : "hover:shadow-[0_0_0_1px_rgba(47,158,98,0.25),0_40px_80px_-30px_rgba(47,158,98,0.35)]")}
    >
      <div className={cn("pointer-events-none absolute -right-24 -top-24 size-72 rounded-full blur-3xl transition-opacity group-hover:opacity-100", tuned ? "bg-[#cfe9f5] opacity-70" : "bg-seal-mint/70 opacity-60")} />
      <div className="relative flex h-24 items-center">
        {t.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.logo.src} alt={t.hospital} width={t.logo.width} height={t.logo.height} className="h-[84px] w-auto" />
        ) : (
          <SealLogo height={60} className="text-ink" />
        )}
      </div>
      <p className="eyebrow relative mt-8">{t.card.kicker}</p>
      <h2 className="display relative mt-3 text-[38px] leading-tight md:text-[44px]">{t.card.title}</h2>
      <p className="relative mt-4 max-w-md text-[16px] font-light leading-relaxed text-ink/70">{t.card.body}</p>
      <div className="relative mt-8 grid grid-cols-3 gap-4 border-t border-ink/[0.08] pt-6">
        {t.card.facts.map((f) => (
          <div key={f.k}>
            <div className={cn("dot whitespace-nowrap text-[19px] leading-none sm:text-[26px] md:text-[30px]", tuned ? "text-[#0a6c9b]" : "text-seal-deep")}>{f.v}</div>
            <div className="mt-2 text-[12px] font-light leading-snug text-ink/55">{f.k}</div>
          </div>
        ))}
      </div>
      <ul className="relative mt-7 space-y-2.5">
        {t.card.points.map((p) => (
          <li key={p} className="flex items-start gap-2.5 text-[14px] font-light text-ink/75">
            <Check className={cn("mt-0.5 size-4 shrink-0", tuned ? "text-[#0a6c9b]" : "text-seal-deep")} />
            {p}
          </li>
        ))}
      </ul>
      <div className="relative mt-auto pt-9">
        <span className={cn("inline-flex items-center gap-2.5 rounded-full px-6 py-3.5 text-[15px] font-normal text-white transition-transform group-hover:translate-x-1", tuned ? "bg-[#0a6c9b]" : "bg-ink")}>
          {t.card.cta} <ArrowRight className="size-4" />
        </span>
      </div>
    </motion.a>
  );
}
