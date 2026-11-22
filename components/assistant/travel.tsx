"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Orb } from "./orb";
import { assistant, useAssistant } from "./store";

/**
 * SEAL taking someone to another screen: the page softens behind frosted glass, a band of mint
 * light sweeps across, and a chip says where they are going. When the new screen has arrived the
 * glass lifts. Never longer than about two seconds, and it never blocks a click.
 */
export function Travel() {
  const { travel } = useAssistant();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  // Arrived (the address changed to the destination): lift the glass after the new page has painted.
  useEffect(() => {
    if (!travel) return;
    const here = pathname + (search ? `?${search}` : "");
    const arrived = here === travel.path || pathname === travel.path.split("?")[0];
    const t = setTimeout(() => assistant.set((s) => (s.travel?.id === travel.id ? { travel: null } : {})), arrived ? 420 : 2200);
    return () => clearTimeout(t);
  }, [travel, pathname, search]);

  return (
    <AnimatePresence>
      {travel && (
        <motion.div key={travel.id} className="pointer-events-none fixed inset-0 z-[58] overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }} transition={{ duration: 0.2 }}>
          {/* frosted veil */}
          <div className="absolute inset-0 bg-[#eef2f0]/45 backdrop-blur-[6px]" />
          {/* the sweep of light */}
          <motion.div
            className="absolute inset-y-0 w-[55%] bg-[linear-gradient(90deg,transparent,rgba(191,240,214,0.75),rgba(160,220,255,0.45),transparent)] blur-2xl"
            initial={{ x: "-60%" }}
            animate={{ x: "190%" }}
            transition={{ duration: 0.9, ease: [0.45, 0, 0.2, 1] }}
          />
          {/* where to */}
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center gap-3 rounded-full bg-white/80 py-2 pl-2 pr-6 ring-1 ring-white shadow-[0_24px_60px_-24px_rgba(31,43,41,0.45)] backdrop-blur-2xl"
            >
              <Orb size={40} status="thinking" />
              <div className="leading-tight">
                <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-ink/45">Taking you to</div>
                <div className="text-[16px] font-normal text-ink">{travel.label}</div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
