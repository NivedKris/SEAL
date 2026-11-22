"use client";

import { assistant, type Proposal } from "./store";
import { applyProposal } from "./apply";
import { pathFor, type Destination } from "@/lib/assistant/sitemap";
import { PAGE_DATA } from "@/lib/client/page-data";
import { prefetch } from "@/lib/client/data";

/**
 * The assistant's hands in the browser: moving around SEAL (at once, no approval: it never changes
 * a record), offering "Take me there?", reading what is on screen, and carrying out a change the
 * person has just said yes to. Shared by the voice session and the typed chat.
 */
let push: (path: string) => void = (p) => window.location.assign(p);
let back: () => void = () => window.history.back();
export function setNavigator(nav: { push: (path: string) => void; back: () => void }) {
  push = nav.push;
  back = nav.back;
}

/** Everything the assistant needs to know about the screen, sent with every request. */
export function contextNow() {
  const s = assistant.get();
  return {
    path: s.path,
    encounterId: s.page.encounterId,
    claimId: s.page.claimId,
    questionSetId: s.page.questionSetId,
    screen: s.screen.title || s.screen.items?.length ? { ...s.screen, items: s.screen.items?.slice(0, 40) } : undefined,
    pending: pendingChanges(),
  };
}
const pendingChanges = () =>
  assistant
    .get()
    .proposals.filter((p) => p.status === "pending")
    .slice(-10)
    .map((p) => ({ id: p.id, tool: p.tool, args: p.args }));

/** "L4", "L000004", "clm-L000004" → the claim id. */
const claimId = (x?: string) => {
  if (!x) return x;
  const t = x.trim();
  const m = /^(?:clm-)?L0*(\d+)$/i.exec(t);
  return m ? `clm-L${m[1].padStart(6, "0")}` : t;
};

/** A doctor's name → their id (ids look like dr-…/pt-…; names are looked up). */
async function doctorId(x?: string) {
  if (!x || /^(dr|pt)-[a-z0-9-]+$/.test(x)) return x;
  const r = await fetch("/api/assistant/tool", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "doctor_profile", args: { doctor: x }, context: contextNow() }) })
    .then((r) => r.json())
    .catch(() => null);
  return (r?.result?.id as string | undefined) ?? x;
}

async function destination(args: Record<string, unknown>) {
  const d = { ...(args as unknown as Destination) };
  d.claim = claimId(d.claim);
  d.claims = d.claims?.map((c) => claimId(c)!);
  d.doctor = await doctorId(d.doctor);
  return pathFor(d);
}

/**
 * Open a path, warming its data on the way. When SEAL does it, a short travel animation plays
 * (./travel.tsx): the screen softens, then the new one arrives underneath.
 */
export function go(path: string, label?: string) {
  const base = path.split("?")[0];
  PAGE_DATA[base]?.forEach((u) => prefetch(u));
  const here = window.location.pathname + window.location.search;
  if (here === path) return;
  assistant.set({ travel: { id: Date.now(), label: label ?? "the next screen", path } });
  // let the veil appear first, so the change happens behind it
  setTimeout(() => push(path), 220);
}

export async function runScreenTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (name) {
    case "navigate": {
      const to = await destination(args);
      if ("error" in to) return { error: to.error };
      go(to.path, to.label);
      if (assistant.get().offer?.status === "open") assistant.set((s) => ({ offer: s.offer && { ...s.offer, status: "taken" } }));
      return { status: `Opened ${to.label} on the person's screen. Say in one short sentence what is there now.` };
    }
    case "offer_navigation": {
      const to = await destination(args);
      if ("error" in to) return { error: to.error };
      assistant.set({ offer: { id: `o${Date.now().toString(36)}`, path: to.path, label: to.label, question: String(args.question ?? `Take you to ${to.label}?`), status: "open" } });
      return { status: `A "Take me there" button for ${to.label} is on screen. Ask whether to take them; if they say yes, call navigate with the same destination.` };
    }
    case "get_screen":
      return screenNow();
    case "go_back":
      back();
      return { status: "Went back." };
    case "confirm_change": {
      const p = findProposal(args.proposalId);
      if (!p) return { error: "no change waiting with that id" };
      if (p.status !== "pending" && p.status !== "failed") return { status: `Already ${p.status}.` };
      await applyProposal(p, go);
      const after = assistant.get().proposals.find((x) => x.id === p.id);
      return after?.status === "done" ? { status: "Done.", ...(after.args.sent ? { sent: after.args.sent } : {}) } : { error: after?.note ?? "it could not be done" };
    }
    case "reject_change": {
      const p = findProposal(args.proposalId);
      if (p) assistant.updateProposal(p.id, { status: "rejected" });
      return { status: "Dropped." };
    }
  }
  return { error: `unknown screen action ${name}` };
}

const findProposal = (id: unknown): Proposal | undefined => {
  const all = assistant.get().proposals;
  // the id the model was given; if it lost it, the only change waiting is the one meant
  return all.find((p) => p.id === id) ?? (all.filter((p) => p.status === "pending").length === 1 ? all.find((p) => p.status === "pending") : undefined);
};

/** get_screen, from what the page reported. */
export function screenNow() {
  const s = assistant.get();
  return {
    path: s.path,
    title: s.screen.title ?? s.page.label ?? null,
    tab: s.screen.tab ?? null,
    details: s.screen.details ?? null,
    items: (s.screen.items ?? []).map((x, i) => ({ n: i + 1, ...x })),
    openClaim: s.page.claimId ?? null,
    openVisit: s.page.encounterId ?? null,
    waitingChanges: pendingChanges(),
  };
}

/** Carry out the screen actions the typed assistant asked for (it cannot reach the browser itself). */
export async function runActions(actions: { tool: string; args: Record<string, unknown> }[]) {
  for (const a of actions) {
    if (a.tool === "navigate" && typeof a.args.path === "string") go(a.args.path, typeof a.args.label === "string" ? a.args.label : undefined);
    else if (a.tool === "offer_navigation" && typeof a.args.path === "string") assistant.set({ offer: { id: `o${Date.now().toString(36)}`, path: a.args.path, label: String(a.args.label ?? a.args.path), question: String(a.args.question ?? "Take you there?"), status: "open" } });
    else await runScreenTool(a.tool, a.args);
  }
}

// Development only: lets a test script make the same move the assistant makes (no AI call needed).
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as unknown as { __sealGo?: typeof go }).__sealGo = go;
