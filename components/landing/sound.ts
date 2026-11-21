"use client";

import { useSyncExternalStore } from "react";

/**
 * The landing film's soundtrack: one looping track, off until the visitor turns it on
 * (browsers only allow sound after a tap). Drop the file at public/audio/seal-theme.mp3.
 * If the file is missing, the Sound control hides itself.
 */
export const THEME_SRC = "/audio/seal-theme.mp3";

type State = { on: boolean; available: boolean };
let state: State = { on: false, available: false };
let audio: HTMLAudioElement | null = null;
let fade: ReturnType<typeof setInterval> | null = null;
const subs = new Set<() => void>();
const set = (s: Partial<State>) => {
  state = { ...state, ...s };
  subs.forEach((f) => f());
};

let probed = false;
function probe() {
  if (probed || typeof window === "undefined") return;
  probed = true;
  fetch(THEME_SRC, { method: "HEAD" })
    .then((r) => set({ available: r.ok }))
    .catch(() => set({ available: false }));
}

function ramp(to: number, ms = 1200, then?: () => void) {
  if (!audio) return;
  if (fade) clearInterval(fade);
  const from = audio.volume;
  const t0 = performance.now();
  fade = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    audio!.volume = from + (to - from) * k;
    if (k >= 1) {
      clearInterval(fade!);
      fade = null;
      then?.();
    }
  }, 30);
}

export function toggleSound() {
  if (!state.available) return;
  if (!audio) {
    audio = new Audio(THEME_SRC);
    audio.loop = true;
    audio.volume = 0;
  }
  if (state.on) {
    set({ on: false });
    ramp(0, 800, () => audio?.pause());
  } else {
    set({ on: true });
    void audio.play().catch(() => set({ on: false }));
    ramp(0.7, 1600);
  }
}

/** Stop the soundtrack (leaving the landing). */
export function stopSound() {
  if (audio && state.on) {
    set({ on: false });
    ramp(0, 500, () => audio?.pause());
  }
}

export function useSound(): State {
  return useSyncExternalStore(
    (f) => {
      probe();
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => state,
  );
}
