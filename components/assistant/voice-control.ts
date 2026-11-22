"use client";

import { assistant, type Mode } from "./store";

/**
 * Starting and stopping voice. The Gemini Live library is large, so it is loaded only the first
 * time someone talks or scribes.
 *  - Talk lives in the voice bar (bottom centre, Siri-style) and keeps going while SEAL moves
 *    between screens.
 *  - Scribe lives in the panel, on a patient's visit.
 */
let loaded = false;
const live = () => ((loaded = true), import("./live"));

export async function startVoice() {
  const s = assistant.get();
  if (s.voice.on && s.live.status !== "error") return;
  if (s.mode === "scribe") await stopLiveOnly();
  assistant.set((x) => ({ voice: { on: true, from: x.messages.length, fromProposal: x.proposals.length }, open: false, mode: "talk", offer: null }));
  await (await live()).startLive("talk");
}

export async function stopVoice() {
  assistant.set({ voice: { on: false, from: 0, fromProposal: 0 }, mode: "chat" });
  await stopLiveOnly();
}

/** More detail: hand the conversation over to the chat panel (the same messages, typed from here on). */
export async function openChat() {
  await stopVoice();
  assistant.set({ open: true, mode: "chat" });
}

export const toggleVoice = () => (assistant.get().voice.on ? stopVoice() : startVoice());

/** Panel modes: chat (no voice) or scribe (listens to the consultation). */
export async function setPanelMode(mode: Exclude<Mode, "talk">) {
  if (assistant.get().voice.on) await stopVoice();
  assistant.set({ mode });
  if (mode === "chat") await stopLiveOnly();
  else await (await live()).startLive(mode);
}

async function stopLiveOnly() {
  if (loaded) await (await live()).stopLive();
}

export const sendLiveText = (t: string) => void live().then((l) => l.sendLiveText(t));
export const interruptLive = () => void live().then((l) => l.interruptLive());
