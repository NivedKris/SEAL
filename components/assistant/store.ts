"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * The assistant's state, shared by the orb, the panel, the live voice session and the pages that
 * tell it what is on screen (a patient visit or a claim).
 */
export type Mode = "chat" | "talk" | "scribe";
export type LiveStatus = "off" | "connecting" | "listening" | "thinking" | "speaking" | "error";
export type Msg = { id: string; role: "user" | "assistant" | "note"; text: string; live?: boolean; speaker?: "doctor" | "patient"; detail?: boolean };
export type Proposal = { id: string; tool: string; args: Record<string, unknown>; status: "pending" | "working" | "done" | "rejected" | "failed"; note?: string };
export type PageContext = { encounterId?: string; claimId?: string; questionSetId?: string; label?: string; kind?: "visit" | "claim" | "questions" };
/** What the page lists right now, in order, so "the second one" means something. */
export type ScreenInfo = { title?: string; tab?: string; items?: { id: string; label: string; kind?: string }[]; details?: string };
/** "Take me there?": a place SEAL offered to open. */
export type Offer = { id: string; path: string; label: string; question: string; status: "open" | "taken" | "declined" };

export type State = {
  open: boolean;
  mode: Mode;
  messages: Msg[];
  proposals: Proposal[];
  busy: boolean;
  live: { status: LiveStatus; level: number; error?: string; startedAt?: number };
  page: PageContext;
  path: string;
  screen: ScreenInfo;
  offer: Offer | null;
  /** SEAL is taking the person somewhere: the travel animation shows while the screen changes. */
  travel: { id: number; label: string; path: string } | null;
  /** The voice bar (Siri-style, bottom centre) is on; messages from voiceFrom on belong to it. */
  voice: { on: boolean; from: number; fromProposal: number };
};

let state: State = { open: false, mode: "chat", messages: [], proposals: [], busy: false, live: { status: "off", level: 0 }, page: {}, path: "/", screen: {}, offer: null, travel: null, voice: { on: false, from: 0, fromProposal: 0 } };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const assistant = {
  get: () => state,
  set(patch: Partial<State> | ((s: State) => Partial<State>)) {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    emit();
  },
  setLive(patch: Partial<State["live"]>) {
    state = { ...state, live: { ...state.live, ...patch } };
    emit();
  },
  say(m: Omit<Msg, "id">) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    state = { ...state, messages: [...state.messages, { ...m, id }] };
    emit();
    return id;
  },
  /** Append streaming text to a message (live captions), creating it if needed. */
  stream(id: string, role: Msg["role"], chunk: string, done = false) {
    const i = state.messages.findIndex((m) => m.id === id);
    const messages = [...state.messages];
    if (i < 0) messages.push({ id, role, text: chunk, live: !done });
    else messages[i] = { ...messages[i], text: messages[i].text + chunk, live: !done };
    state = { ...state, messages };
    emit();
  },
  finish(id: string) {
    state = { ...state, messages: state.messages.map((m) => (m.id === id ? { ...m, live: false } : m)) };
    emit();
  },
  propose(tool: string, args: Record<string, unknown>, id?: string) {
    const p: Proposal = { id: id ?? `p${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`, tool, args, status: "pending" };
    // In the voice bar the card shows above the bar; otherwise the panel opens to show it.
    state = { ...state, proposals: [...state.proposals, p], open: state.voice.on ? state.open : true };
    emit();
    return p;
  },
  updateProposal(id: string, patch: Partial<Proposal>) {
    state = { ...state, proposals: state.proposals.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
    emit();
  },
};

export function useAssistant(): State {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => state,
  );
}

/** Pages call this to tell the assistant what is on screen. */
export function setAssistantPage(page: PageContext) {
  const same = state.page.encounterId === page.encounterId && state.page.claimId === page.claimId && state.page.questionSetId === page.questionSetId && state.page.label === page.label;
  if (!same) assistant.set({ page });
}

/** Pages call this to say what they list (tab and items in order). */
export function setAssistantScreen(screen: ScreenInfo) {
  const key = (x: ScreenInfo) => `${x.title}|${x.tab}|${x.items?.map((i) => i.id).join(",")}`;
  if (key(state.screen) !== key(screen)) assistant.set({ screen });
}

/** A page says what it lists while it is open (null: nothing to say yet). Cleared when it closes. */
export function useAssistantScreen(info: ScreenInfo | null) {
  const key = info ? JSON.stringify(info) : "";
  useEffect(() => {
    if (!key) return;
    setAssistantScreen(JSON.parse(key) as ScreenInfo);
    return () => setAssistantScreen({});
  }, [key]);
}

/** Events the assistant sends to the open page (note text to write, or "reload"). */
export type PageEvent =
  | { kind: "note"; field: "complaint" | "findings" | "plan"; text: string; mode: "append" | "replace" }
  | { kind: "answer"; setId: string; gapId: string; key: string; value: string | number }
  | { kind: "refresh" };
export const PAGE_EVENT = "seal:assistant";
export const sendToPage = (e: PageEvent) => window.dispatchEvent(new CustomEvent<PageEvent>(PAGE_EVENT, { detail: e }));
