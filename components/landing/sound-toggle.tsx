"use client";

import { toggleSound, useSound } from "./sound";
import { cn } from "@/lib/utils";

/**
 * Equaliser button: bars dance while the soundtrack plays and lie flat when muted.
 * Tap to mute or unmute.
 */
export function SoundToggle({ className }: { className?: string }) {
  const { on, available } = useSound();
  return (
    <button
      onClick={toggleSound}
      aria-pressed={on}
      aria-label={!available ? "Sound unavailable" : on ? "Mute sound" : "Play sound"}
      title={!available ? "Sound unavailable" : on ? "Mute" : "Sound on"}
      className={cn(
        "flex size-11 items-center justify-center rounded-full bg-white/40 ring-1 ring-[#1f2b29]/15 backdrop-blur-xl transition-colors hover:bg-white/60",
        !available && "cursor-default opacity-50",
        className,
      )}
    >
      <span className="flex h-4 items-end gap-[3px]">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn("w-[2.5px] rounded-full bg-[#1f2b29] transition-[height,opacity] duration-500", on ? "eq-bar" : "opacity-45")}
            style={on ? { animationDelay: `${i * -0.27}s`, animationDuration: `${0.9 + (i % 2) * 0.35}s` } : { height: [5, 9, 6, 11][i] }}
          />
        ))}
      </span>
    </button>
  );
}
