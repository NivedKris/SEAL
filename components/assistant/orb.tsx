"use client";

import type { LiveStatus } from "./store";
import { cn } from "@/lib/utils";

/**
 * SEAL's orb: the landing film's glass pebble, alive. Idle it breathes with a warm heartbeat;
 * listening it turns mint and swells with the voice; thinking, light runs round its rim;
 * speaking, it ripples with SEAL's voice.
 */
export function Orb({ size = 64, status = "off", level = 0, className }: { size?: number; status?: LiveStatus | "busy"; level?: number; className?: string }) {
  const listening = status === "listening";
  const speaking = status === "speaking";
  const thinking = status === "thinking" || status === "connecting" || status === "busy";
  const lvl = Math.min(1, level);
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }} aria-hidden>
      {/* halo */}
      <span
        className={cn("absolute inset-[-35%] rounded-full blur-xl transition-opacity duration-500", listening ? "bg-seal-mint" : speaking ? "bg-[#ffe1b0]" : "bg-seal-mint/60", status === "off" ? "opacity-40" : "opacity-90")}
        style={{ transform: `scale(${0.85 + lvl * 0.45})` }}
      />
      {/* rim light while thinking */}
      {thinking && <span className="orb-spin absolute inset-[-3px] rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,#2f9e62_70deg,#bff0d6_120deg,transparent_200deg)] opacity-80" />}
      {/* ripples while speaking */}
      {speaking && (
        <>
          <span className="orb-ripple absolute inset-0 rounded-full ring-2 ring-[#f0b45a]/50" />
          <span className="orb-ripple absolute inset-0 rounded-full ring-2 ring-[#f0b45a]/40 [animation-delay:0.6s]" />
        </>
      )}
      {/* glass sphere */}
      <span
        className={cn("relative h-full w-full rounded-full ring-1 ring-white/80", status === "off" && "orb-breathe")}
        style={{
          background: "radial-gradient(circle at 34% 28%, #ffffff 0%, #f4fbf7 28%, #d5f0e2 58%, #a8dcc2 85%, #8fcfb1 100%)",
          boxShadow: "inset 0 -8px 18px rgba(31,43,41,0.12), inset 0 6px 14px rgba(255,255,255,0.9), 0 12px 30px -10px rgba(31,43,41,0.35)",
          transform: `scale(${1 + lvl * (listening ? 0.12 : speaking ? 0.08 : 0)})`,
          transition: "transform 90ms linear",
        }}
      >
        {/* core */}
        <span
          className={cn("absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full", status === "off" && "heartbeat")}
          style={{
            width: size * (0.22 + lvl * 0.18),
            height: size * (0.22 + lvl * 0.18),
            background: listening ? "radial-gradient(circle, #ffffff 0%, #7fe6b0 45%, #2f9e62 100%)" : "radial-gradient(circle, #fff8ea 0%, #ffd79a 45%, #f0b45a 100%)",
            boxShadow: listening ? "0 0 18px 4px rgba(127,230,176,0.75)" : "0 0 18px 4px rgba(240,180,90,0.6)",
            transition: "width 90ms linear, height 90ms linear, background 400ms",
          }}
        />
        {/* highlight */}
        <span className="absolute left-[22%] top-[14%] h-[22%] w-[34%] rounded-full bg-white/80 blur-[2px]" />
      </span>
    </span>
  );
}
