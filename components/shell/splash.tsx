"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { SealLogo } from "@/components/brand/seal-logo";
import GradientText from "@/components/GradientText";

/**
 * Start-up, like a new iPhone: greetings fade in and out, the SEAL wordmark rises, and the screen
 * dissolves into the app. Once per browser session; any key or click skips; ?splash=0 skips.
 */
const MESSAGES: { text: string; dir?: "rtl"; big?: boolean }[] = [
  { text: "hello", big: true },
  { text: "مرحبا", dir: "rtl", big: true },
  { text: "Every order, checked." },
  { text: "Every claim, paid." },
];
const STEP_MS = 1150;

export function Splash() {
  // The landing opens with its own one-liner, so the greeting only plays when entering the app.
  return usePathname() === "/" ? null : <Greeting />;
}

function Greeting() {
  const [stage, setStage] = useState<number>(0); // 0..MESSAGES.length-1 = messages, MESSAGES.length = logo
  const [show, setShow] = useState(true);
  const [instant, setInstant] = useState(false);

  const finish = useCallback(() => setShow(false), []);

  useEffect(() => {
    let seen = new URLSearchParams(window.location.search).get("splash") === "0";
    try {
      seen ||= sessionStorage.getItem("seal-splash") === "1";
      sessionStorage.setItem("seal-splash", "1");
    } catch {}
    if (seen) {
      setInstant(true);
      setShow(false);
      return;
    }
    const timers = [...MESSAGES.map((_, i) => setTimeout(() => setStage(i + 1), STEP_MS * (i + 1))), setTimeout(finish, STEP_MS * MESSAGES.length + 1900)];
    const skip = () => finish();
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [finish]);

  const m = MESSAGES[stage];
  return (
    <AnimatePresence>
      {show && (
        <motion.div key="splash" className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#e9efec]" exit={{ opacity: 0, scale: 1.04, filter: "blur(10px)" }} transition={{ duration: instant ? 0 : 0.9, ease: [0.22, 1, 0.36, 1] }}>
          {/* drifting green light */}
          <motion.div className="pointer-events-none absolute size-[900px] rounded-full bg-[radial-gradient(circle,rgba(255,248,232,0.9),transparent_62%)]" animate={{ x: [-120, 140, -60], y: [-60, 80, -20], scale: [1, 1.15, 1] }} transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }} />
          <motion.div className="pointer-events-none absolute size-[700px] rounded-full bg-[radial-gradient(circle,rgba(191,240,214,0.55),transparent_60%)]" animate={{ x: [160, -100, 120], y: [100, -40, 60] }} transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }} />

          <AnimatePresence mode="wait">
            {m ? (
              <motion.div
                key={stage}
                dir={m.dir}
                initial={{ opacity: 0, y: 14, filter: "blur(14px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -10, filter: "blur(14px)" }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                className={m.big ? "display text-[72px] leading-none sm:text-[96px] md:text-[120px]" : "display px-6 text-center text-[34px] leading-tight text-ink md:text-[56px]"}
              >
                {m.big ? (
                  <GradientText colors={["#1f2b29", "#2f9e62", "#7fdcaa", "#1f2b29"]} animationSpeed={4} className="!m-0 !bg-transparent italic">
                    {m.text}
                  </GradientText>
                ) : (
                  m.text
                )}
              </motion.div>
            ) : (
              <motion.div key="logo" className="relative flex flex-col items-center text-ink" initial={{ opacity: 0, scale: 0.86, filter: "blur(12px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}>
                <motion.div className="absolute size-56 rounded-full bg-seal-mint/70 blur-3xl" animate={{ opacity: [0.3, 0.9, 0.4], scale: [0.8, 1.2, 1] }} transition={{ duration: 1.8, ease: "easeInOut" }} />
                <div className="relative">
                  <SealLogo height={72} />
                </div>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.6 }} className="relative mt-6 text-[15px] font-light tracking-[0.2em] text-ink/55">
                  EVERY CLAIM, COMPLETE.
                </motion.p>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="absolute bottom-10 text-[12px] font-light tracking-[0.2em] text-ink/40">
            PRESS ANY KEY TO SKIP
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
