"use client";

import { useCallback, useEffect, useState } from "react";
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
  { text: "Welcome to Seabreeze." },
  { text: "Every order, checked." },
  { text: "Every claim, paid." },
];
const STEP_MS = 1150;

export function Splash() {
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
        <motion.div key="splash" className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#030405]" exit={{ opacity: 0, scale: 1.04, filter: "blur(10px)" }} transition={{ duration: instant ? 0 : 0.9, ease: [0.22, 1, 0.36, 1] }}>
          {/* drifting green light */}
          <motion.div className="pointer-events-none absolute size-[900px] rounded-full bg-[radial-gradient(circle,rgba(62,207,127,0.22),transparent_62%)]" animate={{ x: [-120, 140, -60], y: [-60, 80, -20], scale: [1, 1.15, 1] }} transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }} />
          <motion.div className="pointer-events-none absolute size-[700px] rounded-full bg-[radial-gradient(circle,rgba(42,120,214,0.14),transparent_60%)]" animate={{ x: [160, -100, 120], y: [100, -40, 60] }} transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }} />

          <AnimatePresence mode="wait">
            {m ? (
              <motion.div
                key={stage}
                dir={m.dir}
                initial={{ opacity: 0, y: 14, filter: "blur(14px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -10, filter: "blur(14px)" }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                className={m.big ? "display text-[120px] leading-none" : "display text-[56px] leading-tight text-white"}
              >
                {m.big ? (
                  <GradientText colors={["#ffffff", "#9ef0c4", "#3ecf7f", "#ffffff"]} animationSpeed={4} className="!m-0 !bg-transparent italic">
                    {m.text}
                  </GradientText>
                ) : (
                  m.text
                )}
              </motion.div>
            ) : (
              <motion.div key="logo" className="relative flex flex-col items-center text-white" initial={{ opacity: 0, scale: 0.86, filter: "blur(12px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}>
                <motion.div className="absolute size-56 rounded-full bg-seal-green/25 blur-3xl" animate={{ opacity: [0.3, 0.9, 0.4], scale: [0.8, 1.2, 1] }} transition={{ duration: 1.8, ease: "easeInOut" }} />
                <div className="relative">
                  <SealLogo height={96} />
                </div>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.6 }} className="relative mt-6 text-[16px] tracking-[0.02em] text-white/55">
                  Claims that don&apos;t come back.
                </motion.p>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="absolute bottom-10 text-[13px] text-white/30">
            Press any key to skip
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
