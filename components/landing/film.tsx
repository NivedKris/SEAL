"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Lenis from "lenis";
import { AnimatePresence, motion, useScroll, useTransform, type MotionValue } from "motion/react";
import { ArrowRight } from "lucide-react";
import { SealLogo } from "@/components/brand/seal-logo";
import { HospitalLoop } from "@/components/marketing/hospital-loop";
import { CHAPTERS, film } from "./film-state";
import { autoStart } from "./sound";
import { SoundToggle } from "./sound-toggle";
import { cn } from "@/lib/utils";

const FilmScene = dynamic(() => import("./film-scene"), { ssr: false });

const INK = "#1f2b29";
const STORY = CHAPTERS.filter((c) => c.n);

/**
 * The landing page as a quiet film, told in seven short chapters over one misty 3D world.
 * Scroll (or press and hold) to move through it; the bottom line shows where you are.
 */
export function Film() {
  const sections = useRef<(HTMLElement | null)[]>([]);
  const lenisRef = useRef<Lenis | null>(null);
  const [lite, setLite] = useState(false);
  const [ready, setReady] = useState(false);
  const [chapter, setChapter] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setLite(window.matchMedia("(max-width: 768px)").matches || (navigator.hardwareConcurrency ?? 8) <= 4);
    setReady(true);
    // The soundtrack starts by itself if the browser allows it, otherwise on the first tap or key.
    void autoStart();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lenis = reduce ? null : new Lenis({ autoRaf: true, lerp: 0.075, wheelMultiplier: 0.85 });
    lenisRef.current = lenis;

    // Scroll → film progress: chapter i's moment is reached when its section reaches the top.
    const update = () => {
      const y = window.scrollY;
      const tops = sections.current.map((el) => (el ? el.offsetTop : 0));
      tops.push(document.documentElement.scrollHeight - window.innerHeight);
      const ats = [...CHAPTERS.map((c) => c.at), 1];
      let i = 0;
      while (i < tops.length - 2 && y >= tops[i + 1] - 1) i++;
      const local = Math.min(1, Math.max(0, (y - tops[i]) / Math.max(1, tops[i + 1] - tops[i])));
      film.target = ats[i] + (ats[i + 1] - ats[i]) * local;
      setChapter(i);
      setProgress(film.target);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      lenis?.destroy();
      // the music carries on into the greeting and the hospital picker
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const goTo = useCallback((i: number) => {
    const el = sections.current[i];
    if (!el) return;
    if (lenisRef.current) lenisRef.current.scrollTo(el.offsetTop + 2, { duration: 2.4 });
    else window.scrollTo({ top: el.offsetTop + 2, behavior: "smooth" });
  }, []);

  const reg = (i: number) => (el: HTMLElement | null) => void (sections.current[i] = el);
  const inStory = chapter < STORY.length;

  return (
    <main className="relative bg-[#e3eae7]" style={{ color: INK }}>
      {/* the one continuous shot */}
      <div className="fixed inset-0 z-0">
        {ready && <FilmScene lite={lite} />}
        {/* a soft light leak, like early morning through glass */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_10%,rgba(255,248,232,0.45),transparent_55%),radial-gradient(ellipse_at_90%_90%,rgba(196,236,216,0.35),transparent_50%)]" />
      </div>

      <div className="relative z-10">
        <Chapter id={0} reg={reg} first>
          {(o) => <Story o={o} n="I" title="Every claim begins with care." />}
        </Chapter>
        <Chapter id={1} reg={reg}>
          {(o) => (
            <Story o={o} n="II" title="A diagnosis. A decision. A set of tests.">
              The reasoning lives with the doctor.
            </Story>
          )}
        </Chapter>
        <Chapter id={2} reg={reg}>
          {(o) => (
            <Story o={o} n="III" title="The claim carries the codes." side="right">
              The reasoning stays behind.
            </Story>
          )}
        </Chapter>
        <Chapter id={3} reg={reg}>
          {(o) => <Story o={o} n="IV" title="Submitted. Out of view." />}
        </Chapter>
        <Chapter id={4} reg={reg}>
          {(o) => (
            <Story o={o} n="V" title="Weeks later, it returns." center>
              Declined.
            </Story>
          )}
        </Chapter>
        <Chapter id={5} reg={reg}>
          {(o) => <Story o={o} n="VI" title="Across the region, this happens thousands of times a day." center wide />}
        </Chapter>
        <Chapter id={6} reg={reg}>
          {(o) => <SealArrives o={o} />}
        </Chapter>
        <Chapter id={7} reg={reg}>
          {(o) => (
            <Story o={o} n="VIII" title="The right question, at the right time.">
              The doctor confirms. The claim is complete.
            </Story>
          )}
        </Chapter>
        <Chapter id={8} reg={reg}>
          {(o) => (
            <Story o={o} n="IX" title="Accepted. The first time." side="right" cta />
          )}
        </Chapter>

        <Chapter id={9} reg={reg}>
          {(o) => (
            <motion.div style={{ opacity: o }} className="mx-auto w-full max-w-[1100px] px-6 text-center">
              <div className="grid gap-14 sm:grid-cols-2">
                <Figure big="1 in 7" label="claims declined in Dubai" />
                <Figure big="AED 2.7–3.8 bn" label="estimated each year, across the UAE" small />
              </div>
              <p className="mx-auto mt-16 max-w-xl text-[22px] font-extralight leading-snug sm:text-[28px]">Every outcome makes the next claim stronger.</p>
            </motion.div>
          )}
        </Chapter>

        {/* The hospitals: their own moment, in the middle of the screen */}
        <Chapter id={10} reg={reg}>
          {(o) => (
            <motion.div style={{ opacity: o }} className="w-full text-center">
              <p className="text-[12px] font-light tracking-[0.35em] text-[#1f2b29]/55">BUILT FOR HOSPITALS ACROSS THE REGION</p>
              <div className="relative mx-auto mt-12 w-full max-w-[1400px] py-8">
                <div className="pointer-events-none absolute inset-0 rounded-[40px] bg-white/25 ring-1 ring-white/50 backdrop-blur-md" />
                <div className="relative">
                  <HospitalLoop />
                </div>
              </div>
            </motion.div>
          )}
        </Chapter>

        <section ref={reg(11)} className="relative">
          <Ending />
          <div className="relative bg-gradient-to-b from-transparent to-[#f1eee6] pb-10 pt-10">
            <footer className="mx-auto flex max-w-[1200px] flex-col items-center gap-4 px-6 text-center text-[13px] text-[#1f2b29]/55 sm:flex-row sm:justify-between sm:text-left">
              <SealLogo height={22} className="text-[#1f2b29]" />
              <span>© {new Date().getFullYear()} SEAL. Every claim, complete.</span>
              <span>Dubai · Built for DHA eClaimLink</span>
            </footer>
          </div>
        </section>
      </div>

      <SoundToggle className="fixed bottom-[88px] right-5 z-30 md:bottom-[92px] md:right-8" />
      <AnimatePresence>{inStory && ready && <Timeline chapter={chapter} progress={progress} onPick={goTo} />}</AnimatePresence>
    </main>
  );
}

// ── Chapters ─────────────────────────────────────────────────────────────────
function Chapter({ id, reg, first, children }: { id: number; reg: (i: number) => (el: HTMLElement | null) => void; first?: boolean; children: (o: MotionValue<number>) => React.ReactNode }) {
  const ref = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  // computed in JS (function form) so every browser fades the same way
  const o = useTransform(scrollYProgress, (v) => {
    const fadeIn = first ? 1 : Math.min(1, Math.max(0, (v - 0.26) / 0.12));
    const fadeOut = 1 - Math.min(1, Math.max(0, (v - 0.56) / 0.12));
    return Math.min(fadeIn, fadeOut);
  });
  return (
    <section
      ref={(el) => {
        ref.current = el;
        reg(id)(el);
      }}
      className="relative h-[200vh]"
    >
      <div className="sticky top-0 flex h-[100svh] w-full items-end pb-[24vh] md:items-center md:pb-0">{children(o)}</div>
    </section>
  );
}

function Story({ o, n, title, children, side = "left", center, wide, cta }: { o: MotionValue<number>; n: string; title: string; children?: React.ReactNode; side?: "left" | "right"; center?: boolean; wide?: boolean; cta?: boolean }) {
  const y = useTransform(o, [0, 1], [18, 0]);
  const blur = useTransform(o, (v) => `blur(${(1 - v) * 8}px)`);
  return (
    <motion.div style={{ opacity: o, y, filter: blur }} className={cn("w-full px-6 md:px-[8vw]", center ? "text-center" : side === "right" ? "flex justify-end" : "")}>
      <div className={cn(wide ? "max-w-[820px]" : "max-w-[560px]", center && "mx-auto")}>
        <div className={cn("flex items-center gap-4 text-[13px] font-light tracking-[0.3em] text-[#1f2b29]/55", center && "justify-center")}>
          <span>{n}</span>
          <span className="h-px w-10 bg-[#1f2b29]/25" />
          <span>{STORY.find((s) => s.n === n)?.title.toUpperCase()}</span>
        </div>
        <h2 className="mt-6 text-[40px] font-extralight leading-[1.08] tracking-[-0.02em] sm:text-[56px] md:text-[64px]">{title}</h2>
        {children && <p className={cn("mt-6 max-w-[420px] text-[19px] font-light leading-[1.6] text-[#1f2b29]/70 sm:text-[22px]", center && "mx-auto")}>{children}</p>}
        {cta && (
          <Link href="/select" className="mt-9 inline-flex items-center gap-2.5 rounded-full bg-[#1f2b29] px-6 py-3.5 text-[15px] font-normal text-[#f1f4f2] transition-transform hover:scale-[1.03]">
            See SEAL at work <ArrowRight className="size-4" />
          </Link>
        )}
      </div>
    </motion.div>
  );
}

function Figure({ big, label, small }: { big: string; label: string; small?: boolean }) {
  return (
    <div className="border-t border-[#1f2b29]/15 pt-8">
      <div className={cn("dot whitespace-nowrap leading-none", small ? "text-[34px] sm:text-[40px] md:text-[54px]" : "text-[64px] md:text-[88px]")}>{big}</div>
      <p className="mt-5 text-[17px] font-light text-[#1f2b29]/70">{label}</p>
    </div>
  );
}

/** VII: SEAL arrives — big, in the middle of the screen, over the rising green light. */
function SealArrives({ o }: { o: MotionValue<number> }) {
  const scale = useTransform(o, [0, 1], [0.82, 1]);
  const blur = useTransform(o, (v) => `blur(${(1 - v) * 14}px)`);
  return (
    <motion.div style={{ opacity: o, filter: blur }} className="flex w-full flex-col items-center px-6 text-center md:self-center">
      <div className="flex items-center gap-4 text-[13px] font-light tracking-[0.3em] text-[#1f2b29]/55">
        <span>VII</span>
        <span className="h-px w-10 bg-[#1f2b29]/25" />
        <span>SEAL</span>
      </div>
      <motion.div style={{ scale }} className="relative mt-8 text-[#1f2b29]">
        <div className="pointer-events-none absolute -inset-x-24 -inset-y-16 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(244,250,246,0.92)_0%,rgba(226,244,233,0.6)_45%,transparent_72%)] blur-xl" />
        <SealLogo height={200} className="relative h-[96px] w-auto drop-shadow-[0_0_40px_rgba(127,230,176,0.45)] sm:h-[150px] md:h-[200px]" />
      </motion.div>
      <p className="relative mt-8 text-[24px] font-extralight leading-snug sm:text-[34px]">Insight at the moment of the order.</p>
    </motion.div>
  );
}

/** The story returns to where it began: the heartbeat, calm. */
function Ending() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });
  const lines = ["Care delivered.", "Value recognised."];
  return (
    <div ref={ref} className="relative h-[220vh]">
      <div className="sticky top-0 flex h-[100svh] flex-col items-center justify-start px-6 pt-[16vh] text-center">
        {lines.map((l, i) => (
          <Line key={l} p={scrollYProgress} from={0.12 + i * 0.12} text={l} />
        ))}
        <SignOff p={scrollYProgress} />
      </div>
    </div>
  );
}
function SignOff({ p }: { p: MotionValue<number> }) {
  const o = useTransform(p, (v) => Math.min(1, Math.max(0, (v - 0.42) / 0.14)));
  const y = useTransform(o, [0, 1], [16, 0]);
  return (
    <motion.div style={{ opacity: o, y }} className="mt-12 flex flex-col items-center">
      <SealLogo height={64} className="text-[#1f2b29]" />
      <p className="mt-4 text-[15px] font-light tracking-[0.3em] text-[#1f2b29]/70">EVERY CLAIM, COMPLETE.</p>
    </motion.div>
  );
}

function Line({ p, from, text }: { p: MotionValue<number>; from: number; text: string }) {
  const o = useTransform(p, (v) => Math.min(1, Math.max(0, (v - from) / 0.1)));
  const blur = useTransform(o, (v) => `blur(${(1 - v) * 10}px)`);
  return (
    <motion.p style={{ opacity: o, filter: blur }} className="text-[32px] font-extralight leading-[1.35] tracking-[-0.01em] sm:text-[48px]">
      {text}
    </motion.p>
  );
}

// ── Bottom: chapter line, and press-and-hold to continue ─────────────────────
function Timeline({ chapter, progress, onPick }: { chapter: number; progress: number; onPick: (i: number) => void }) {
  const end = CHAPTERS[STORY.length].at;
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.8 }} className="fixed inset-x-0 bottom-0 z-20 pb-[max(16px,env(safe-area-inset-bottom))]">
      <div className="mb-5 flex flex-col items-center gap-2 text-[11px] font-light tracking-[0.35em] text-[#1f2b29]/60">
        {chapter === 0 ? "SCROLL TO BEGIN" : "SCROLL"}
        <span className="relative h-8 w-px overflow-hidden bg-[#1f2b29]/15">
          <span className="scroll-cue absolute inset-x-0 top-0 h-3 bg-[#1f2b29]/70" />
        </span>
      </div>
      <div className="mx-auto max-w-[1440px] px-5 md:px-8">
        <div className="relative h-px bg-[#1f2b29]/15">
          <div className="absolute inset-y-0 left-0 bg-[#1f2b29]/70 transition-[width] duration-300" style={{ width: `${Math.min(100, (progress / end) * 100)}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-9">
          {STORY.map((c, i) => (
            <button key={c.key} onClick={() => onPick(i)} className={cn("flex items-baseline gap-2 text-left text-[11px] font-light transition-colors", i === chapter ? "text-[#1f2b29]" : "text-[#1f2b29]/40 hover:text-[#1f2b29]/70")}>
              <span className="tracking-[0.15em]">{c.n}</span>
              <span className="hidden truncate md:inline">{c.title}</span>
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
