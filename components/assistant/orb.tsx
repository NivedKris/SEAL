"use client";

import type { LiveStatus } from "./store";
import { cn } from "@/lib/utils";

/**
 * SEAL's mark as the assistant: the serif S and its full stop on frosted glass. The full stop
 * is SEAL's state: green and beating softly at rest, bright mint swelling with your voice while
 * listening, amber and pulsing while thinking, sky blue rippling while it speaks, red on an error.
 * (Named Orb for the places that already use it.)
 */
const DOT: Record<string, { c: string; glow: string }> = {
  off: { c: "#3ecf7f", glow: "rgba(62,207,127,0.55)" },
  listening: { c: "#22c55e", glow: "rgba(62,207,127,0.85)" },
  thinking: { c: "#f0b45a", glow: "rgba(240,180,90,0.8)" },
  speaking: { c: "#38a8e0", glow: "rgba(56,168,224,0.75)" },
  error: { c: "#d4493d", glow: "rgba(212,73,61,0.6)" },
};

export function Orb({ size = 64, status = "off", level = 0, className }: { size?: number; status?: LiveStatus | "busy"; level?: number; className?: string }) {
  const state = status === "connecting" || status === "busy" ? "thinking" : status;
  const d = DOT[state] ?? DOT.off;
  const lvl = Math.min(1, level);
  const swell = state === "listening" || state === "speaking" ? 1 + lvl * 0.9 : 1;
  const dot = size * 0.17;
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }} aria-hidden>
      {/* soft light in the full stop's colour */}
      <span className="absolute inset-[-28%] rounded-full blur-xl transition-[background,opacity] duration-500" style={{ background: `radial-gradient(circle at 62% 66%, ${d.glow}, transparent 62%)`, opacity: state === "off" ? 0.45 : 0.85 }} />
      {/* frosted disc */}
      <span
        className="relative flex h-full w-full items-center justify-center rounded-full ring-1 ring-white/80"
        style={{
          background: "radial-gradient(circle at 34% 26%, #ffffff 0%, #f7faf8 45%, #e8f0ec 100%)",
          boxShadow: "inset 0 -6px 14px rgba(31,43,41,0.08), inset 0 5px 12px rgba(255,255,255,0.95), 0 12px 28px -12px rgba(31,43,41,0.35)",
        }}
      >
        <span className="relative leading-none text-ink" style={{ fontFamily: "var(--font-source-serif), 'Source Serif 4', Georgia, serif", fontWeight: 800, fontSize: size * 0.56, transform: `translate(${-size * 0.05}px, ${-size * 0.02}px)` }}>
          S
          {/* the full stop */}
          <span
            className={cn("absolute rounded-full", state === "off" && "heartbeat", state === "thinking" && "dot-pulse")}
            style={{
              width: dot,
              height: dot,
              right: -dot * 1.25,
              bottom: size * 0.075,
              background: d.c,
              boxShadow: `0 0 ${size * 0.12}px ${d.glow}`,
              transform: `scale(${swell})`,
              transition: "transform 90ms linear, background 300ms, box-shadow 300ms",
            }}
          />
          {state === "speaking" && (
            <>
              <span className="orb-ripple absolute rounded-full ring-2" style={{ width: dot, height: dot, right: -dot * 1.25, bottom: size * 0.075, ["--tw-ring-color" as string]: "rgba(56,168,224,0.5)" }} />
              <span className="orb-ripple absolute rounded-full ring-2 [animation-delay:0.6s]" style={{ width: dot, height: dot, right: -dot * 1.25, bottom: size * 0.075, ["--tw-ring-color" as string]: "rgba(56,168,224,0.4)" }} />
            </>
          )}
        </span>
      </span>
    </span>
  );
}
