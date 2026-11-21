"use client";

import { useSyncExternalStore } from "react";

/**
 * The assistant's state, shared by the orb, the panel, the live voice session and the pages that
 * tell it what is on screen (a patient visit or a claim).
 */
export type Mode = "chat" | "talk" | "scribe";
export type LiveStatus = "off" | "connecting" | "listening" | "thinking" | "speaking" | "error";
export type Msg = { id: string; role: "user" | "assistant" | "note"; text: string; live?: boolean; speaker?: "doctor" | "patient" };
export type Proposal = { id: string; tool: string; args: Record<string, unknown>; status: "pending" | "working" | "done" | "rejected" | "failed"; note?: string };
export type PageContext = { encounterId?: string; claimId?: string; questionSetId?: string; label?: string; kind?: "visit" | "claim" | "questions" };

export type State = {
  open: boolean;
  mode: Mode;
  messages: Msg[];
  proposals: Proposal[];
  busy: boolean;
  live: { status: LiveStatus; level: number; error?: string; startedAt?: number };
  page: PageContext;
  path: string;
};

let state: State = { open: false, mode: "chat", messages: [], proposals: [], busy: false, live: { status: "off", level: 0 }, page: {}, path: "/" };
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
  propose(tool: string, args: Record<string, unknown>) {
    const p: Proposal = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, tool, args, status: "pending" };
    state = { ...state, proposals: [...state.proposals, p], open: true };
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

/** Events the assistant sends to the open page (note text to write, or "reload"). */
export type PageEvent =
  | { kind: "note"; field: "complaint" | "findings" | "plan"; text: string; mode: "append" | "replace" }
  | { kind: "answer"; setId: string; gapId: string; key: string; value: string | number }
  | { kind: "refresh" };
export const PAGE_EVENT = "seal:assistant";
export const sendToPage = (e: PageEvent) => window.dispatchEvent(new CustomEvent<PageEvent>(PAGE_EVENT, { detail: e }));
