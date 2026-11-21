"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { CodeInfo } from "@/app/api/codes/explain/route";
import { cn } from "@/lib/utils";

// ── One shared cache; requests in the same tick are batched into one call ─────
const cache = new Map<string, CodeInfo>();
const waiting = new Map<string, ((i: CodeInfo | undefined) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const codes = [...waiting.keys()];
  const subs = new Map(waiting);
  waiting.clear();
  fetch(`/api/codes/explain?codes=${encodeURIComponent(codes.join(","))}`)
    .then((r) => r.json())
    .then((r: { codes?: CodeInfo[] }) => {
      for (const i of r.codes ?? []) cache.set(i.code, i);
      for (const [c, fns] of subs) fns.forEach((f) => f(cache.get(c)));
    })
    .catch(() => subs.forEach((fns) => fns.forEach((f) => f(undefined))));
}

export function useCodeInfo(code: string | undefined): CodeInfo | undefined {
  const [info, setInfo] = useState<CodeInfo | undefined>(code ? cache.get(code) : undefined);
  useEffect(() => {
    if (!code) return;
    if (cache.has(code)) return setInfo(cache.get(code));
    let live = true;
    waiting.set(code, [...(waiting.get(code) ?? []), (i) => live && setInfo(i)]);
    timer ??= setTimeout(flush, 30);
    return () => {
      live = false;
    };
  }, [code]);
  return info;
}

const SYSTEM_TONE: Record<CodeInfo["system"], string> = {
  CPT: "bg-[#2a78d6]/10 text-[#22609f] ring-[#2a78d6]/25",
  "ICD-10": "bg-seal-mint/50 text-[#237a4b] ring-seal-deep/25",
  Denial: "bg-[#c2473c]/10 text-[#b23b31] ring-[#c2473c]/25",
};
const SYSTEM_NAME: Record<CodeInfo["system"], string> = { CPT: "Service code (CPT)", "ICD-10": "Diagnosis code (ICD-10)", Denial: "Refusal code (DHA)" };

/** The plain-words card for a code: what it is, its group, and how it went in past claims. */
export function CodeCard({ info, code }: { info?: CodeInfo; code: string }) {
  const h = info?.history;
  const rate = h && h.claims ? h.refusedFirst / h.claims : null;
  return (
    <div className="w-[300px] rounded-2xl bg-[#f7faf8]/95 p-4 text-left text-ink shadow-[0_30px_80px_-24px_rgba(31,43,41,0.4)] ring-1 ring-ink/10 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <span className="dot text-[22px] text-seal-deep">{code}</span>
        {info && <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ring-1", SYSTEM_TONE[info.system])}>{info.system}</span>}
      </div>
      {!info ? (
        <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-white/70" />
      ) : (
        <>
          <p className="mt-2 text-[15px] font-medium leading-snug">{info.label}</p>
          <p className="mt-1 text-[12px] text-ink/50">
            {SYSTEM_NAME[info.system]}
            {info.group ? ` · ${info.group}` : ""}
          </p>
          {info.fix && <p className="mt-3 rounded-xl bg-white/60 px-3 py-2 text-[12px] leading-relaxed text-ink/80">Usual fix: {info.fix}</p>}
          {h && h.claims > 0 && (
            <div className="mt-3 border-t border-ink/10 pt-3">
              <div className="flex items-end justify-between">
                <span className="text-[11px] uppercase tracking-[0.12em] text-ink/40">In {h.claims.toLocaleString()} past claims</span>
                <span className={cn("dot text-[18px]", rate! >= 0.3 ? "text-[#b23b31]" : rate! >= 0.1 ? "text-[#a86f0e]" : "text-seal-deep")}>{Math.round(rate! * 100)}% refused</span>
              </div>
              <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/70">
                <div className="bg-[#c2473c]" style={{ width: `${rate! * 100}%` }} />
              </div>
              {h.topDenials.length > 0 && (
                <p className="mt-2 font-mono text-[11px] text-ink/45">
                  Most often: {h.topDenials.map((t) => `${t.code} ×${t.n}`).join(" · ")}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A code anyone can read: hover (or tap) to see what it means in plain words, what group it
 * belongs to, and how often insurers refused it before.
 */
export function CodeChip({ code, dark, className, showLabel }: { code: string; dark?: boolean; className?: string; showLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const info = useCodeInfo(open || showLabel ? code : undefined);

  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom + 260 > window.innerHeight;
    setPos({ x: Math.min(Math.max(12, r.left), window.innerWidth - 312), y: up ? r.top - 8 : r.bottom + 8, up });
  };
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [open]);

  const tone = info ? SYSTEM_TONE[info.system] : dark ? "bg-white/70 text-ink ring-ink/15" : "bg-secondary text-foreground ring-border";
  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={() => {
          place();
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          place();
          setOpen((o) => !o);
        }}
        className={cn("inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[12px] ring-1 transition-colors", tone, className)}
      >
        <span className="font-semibold">{code}</span>
        {showLabel && info && <span className="truncate font-sans font-normal opacity-80">{info.label}</span>}
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && pos && (
              <motion.div
                initial={{ opacity: 0, y: pos.up ? 6 : -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.16 }}
                className="pointer-events-none fixed z-[90]"
                style={{ left: pos.x, top: pos.y }}
              >
                <div style={{ transform: pos.up ? "translateY(-100%)" : undefined }}>
                  <CodeCard info={info} code={code} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
