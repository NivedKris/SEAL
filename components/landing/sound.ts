"use client";

import { useSyncExternalStore } from "react";

/**
 * The landing film's soundtrack: one looping track. It starts by itself when the browser allows
 * it, otherwise on the visitor's first tap, click or key press (browsers block sound until then).
 * It keeps playing through the greeting and the hospital picker, and fades out when the visitor
 * mutes. A visitor who mutes stays muted next time. Drop the file at public/audio/seal-theme.mp3;
 * if it is missing, the controls hide themselves.
 */
export const THEME_SRC = "/audio/seal-theme.mp3";
const PREF = "seal-sound";
/** Playback volume: half of the device volume (within the 40–60% range). */
const VOLUME = 0.5;

type State = { on: boolean; available: boolean };
let state: State = { on: false, available: false };
let audio: HTMLAudioElement | null = null;
let fade: ReturnType<typeof setInterval> | null = null;
const subs = new Set<() => void>();
const set = (s: Partial<State>) => {
  state = { ...state, ...s };
  subs.forEach((f) => f());
};

let probe: Promise<boolean> | null = null;
function available(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  probe ??= fetch(THEME_SRC, { method: "HEAD" })
    .then((r) => {
      set({ available: r.ok });
      return r.ok;
    })
    .catch(() => false);
  return probe;
}

const mutedByVisitor = () => {
  try {
    return localStorage.getItem(PREF) === "off";
  } catch {
    return false;
  }
};
const remember = (v: "on" | "off") => {
  try {
    localStorage.setItem(PREF, v);
  } catch {}
};

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

function element() {
  if (!audio) {
    audio = new Audio(THEME_SRC);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0;
  }
  return audio;
}

/** Start playing with a gentle fade-in. Resolves false if the browser refused (no gesture yet). */
async function play(): Promise<boolean> {
  const a = element();
  try {
    await a.play();
    set({ on: true });
    ramp(VOLUME, 2200);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the music from a tap or key press. Must be called inside the event handler itself:
 * browsers only allow sound that starts within the visitor's own gesture.
 * Does nothing if the visitor muted it before.
 */
export function beginWithSound() {
  if (mutedByVisitor()) return false;
  const a = element();
  void a
    .play()
    .then(() => {
      set({ on: true, available: true });
      ramp(VOLUME, 2200);
    })
    .catch(() => {});
  return true;
}

let armed = false;
/**
 * Start the soundtrack as soon as possible: right away if the browser allows it, otherwise on the
 * first tap, click or key press. Does nothing if the visitor muted it before or it is playing.
 */
export async function autoStart() {
  if (typeof window === "undefined" || state.on || mutedByVisitor()) return;
  if (!(await available())) return;
  if (await play()) return;
  if (armed) return;
  armed = true;
  const go = () => {
    window.removeEventListener("pointerdown", go, true);
    window.removeEventListener("keydown", go, true);
    window.removeEventListener("touchstart", go, true);
    armed = false;
    if (!state.on && !mutedByVisitor()) void play();
  };
  window.addEventListener("pointerdown", go, true);
  window.addEventListener("keydown", go, true);
  window.addEventListener("touchstart", go, true);
}

export function toggleSound() {
  if (!state.available) return;
  if (state.on) {
    remember("off");
    set({ on: false });
    ramp(0, 800, () => audio?.pause());
  } else {
    remember("on");
    void play();
  }
}

/** Stop the soundtrack (fades out). */
export function stopSound() {
  if (audio && state.on) {
    set({ on: false });
    ramp(0, 500, () => audio?.pause());
  }
}

export function useSound(): State {
  return useSyncExternalStore(
    (f) => {
      void available();
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => state,
  );
}
