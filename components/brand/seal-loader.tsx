"use client";

import { motion } from "motion/react";
import { SealLogo } from "./seal-logo";
import { cn } from "@/lib/utils";

/** The SEAL loader: the wordmark breathing, the full stop pulsing green. Used wherever something loads. */
export function SealLoader({ className, size = 34, label, dark }: { className?: string; size?: number; label?: string; dark?: boolean }) {
  return (
    <div data-seal-loader="" className={cn("flex flex-col items-center justify-center gap-3 py-16", className)}>
      <motion.div className={dark ? "text-white" : "text-foreground"} initial={{ opacity: 0.3 }} animate={{ opacity: [0.3, 1, 0.3], scale: [0.98, 1, 0.98] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}>
        <SealLogo height={size} />
      </motion.div>
      {label && <span className={cn("text-[14px]", dark ? "text-white/50" : "text-muted-foreground")}>{label}</span>}
    </div>
  );
}
