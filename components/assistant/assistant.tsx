"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Check, FileText, Mic, MicOff, Pill, Radio, RotateCw, Send, Stethoscope, Undo2, Wrench, X, ArrowRight, MessageSquare } from "lucide-react";
import { Orb } from "./orb";
import { assistant, useAssistant, type Mode, type Proposal } from "./store";
import { startLive, stopLive, sendLiveText, interruptLive } from "./live";
import { applyProposal } from "./apply";
import { CodeChip } from "@/components/shared/code-chip";
import { cn } from "@/lib/utils";

/**
 * SEAL's assistant: the orb on every screen (⌘K), and a glass panel for chat, voice (Gemini Live)
 * and the consultation scribe. Anything that would change a record arrives as a proposal card.
 */
const HIDDEN = ["/", "/select"];
const FIELD: Record<string, string> = { complaint: "What the patient says", findings: "What you found", plan: "Plan" };

export function Assistant() {
  const pathname = usePathname();
  const router = useRouter();
  const s = useAssistant();

  useEffect(() => {
    const keep = pathname.startsWith("/emr") || pathname.startsWith("/billing/claims/");
    assistant.set((x) => ({ path: pathname, page: keep ? x.page : {} }));
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        assistant.set((x) => ({ open: !x.open }));
      }
      if (e.key === "Escape" && assistant.get().open && assistant.get().mode === "chat") assistant.set({ open: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Leaving a page ends a voice session that belonged to it.
  useEffect(() => {
    if (assistant.get().mode !== "chat") void setMode("chat");
  }, [pathname]);

  if (HIDDEN.includes(pathname)) return null;
  const liveOn = s.live.status !== "off" && s.live.status !== "error";

  return (
    <>
      {/* the orb */}
      <AnimatePresence>
        {!s.open && (
          <motion.button
            key="orb"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            whileHover={{ scale: 1.06 }}
            onClick={() => assistant.set({ open: true })}
            className="group fixed bottom-[calc(84px+env(safe-area-inset-bottom))] right-4 z-[60] md:bottom-7 md:right-7"
            aria-label="Ask SEAL (Ctrl+K)"
          >
            <Orb size={62} status={liveOn ? s.live.status : "off"} level={s.live.level} />
            <span className="pointer-events-none absolute right-[74px] top-1/2 hidden -translate-y-1/2 whitespace-nowrap rounded-full bg-white/80 px-3 py-1.5 text-[12px] font-light text-ink/70 opacity-0 shadow-sm ring-1 ring-ink/[0.07] backdrop-blur transition-opacity group-hover:opacity-100 md:block">
              Ask SEAL · <kbd className="font-sans">⌘K</kbd>
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>{s.open && <Panel key="panel" navigate={(p) => router.push(p)} />}</AnimatePresence>
    </>
  );
}

async function setMode(mode: Mode) {
  assistant.set({ mode });
  if (mode === "chat") await stopLive();
  else await startLive(mode);
}

// ── The panel ────────────────────────────────────────────────────────────────
function Panel({ navigate }: { navigate: (path: string) => void }) {
  const s = useAssistant();
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const visit = s.page.kind === "visit" && !!s.page.encounterId;
  const wide = s.mode === "scribe";

  const lastText = s.messages.at(-1)?.text;
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [s.messages.length, s.proposals.length, lastText]);

  const send = async (q: string) => {
    const t = q.trim();
    if (!t || s.busy) return;
    setText("");
    if (s.mode !== "chat" && s.live.status !== "off" && s.live.status !== "error") return sendLiveText(t);
    assistant.say({ role: "user", text: t });
    assistant.set({ busy: true });
    try {
      const history = assistant
        .get()
        .messages.filter((m) => m.role !== "note" && !m.live)
        .slice(-16)
        .map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
      const r = await fetch("/api/assistant/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history, context: { path: s.path, encounterId: s.page.encounterId, claimId: s.page.claimId, questionSetId: s.page.questionSetId } }) }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      if (r.reply) assistant.say({ role: "assistant", text: r.reply });
      for (const p of r.proposals ?? []) assistant.propose(p.tool, p.args);
    } catch (e) {
      assistant.say({ role: "note", text: `SEAL could not answer: ${(e as Error).message.slice(0, 140)}` });
    } finally {
      assistant.set({ busy: false });
    }
  };

  const pending = s.proposals.filter((p) => p.status === "pending");
  const suggestions = s.page.kind === "questions"
    ? ["Answer these from my note", "Why does the insurer ask this?", "What's still missing?"]
    : s.page.kind === "visit"
    ? ["What will the insurer ask for?", "Answer SEAL's questions for this patient", "Is anything here at risk?"]
    : s.page.kind === "claim"
      ? ["Why is this claim held?", "Fix it", "Send it if it's ready"]
      : s.path.startsWith("/clinic")
        ? ["Break down where we lose money", "Which insurer costs us most, and why?", "How fast does cash arrive?"]
        : s.path.startsWith("/ai-health")
          ? ["How accurate is SEAL?", "What did SEAL learn from our history?", "What does the AI cost per claim?"]
          : s.path.startsWith("/billing")
            ? ["Send all ready claims", "Which appeals are due soonest?", "Break down today's claims by insurer"]
            : ["How are we doing today?", "Which claims need me?", "Which insurer refuses us most?"];

  return (
    <motion.aside
      initial={{ opacity: 0, x: 40, filter: "blur(8px)" }}
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, x: 40, filter: "blur(8px)" }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "fixed inset-x-2 bottom-[calc(76px+env(safe-area-inset-bottom))] top-[72px] z-[60] flex flex-col overflow-hidden rounded-[28px] md:inset-x-auto md:bottom-6 md:right-6 md:top-[76px]",
        "bg-[#f4f8f6]/[0.93] shadow-[0_0_0_1px_rgba(31,43,41,0.06),0_40px_100px_-30px_rgba(31,43,41,0.45)] backdrop-blur-2xl",
        wide ? "md:w-[560px]" : "md:w-[440px]",
      )}
      aria-label="SEAL assistant"
    >
      {/* header */}
      <div className="flex items-center gap-3 border-b border-ink/[0.06] px-5 py-4">
        <Orb size={38} status={s.busy ? "busy" : s.live.status} level={s.live.level} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium leading-tight">SEAL</div>
          <div className="truncate text-[12px] font-light text-ink/55">{s.page.label ? `${s.page.label}` : "Ask about any patient, claim or number"}</div>
        </div>
        <button onClick={() => (s.mode === "chat" ? assistant.set({ open: false }) : void setMode("chat").then(() => assistant.set({ open: false })))} className="rounded-full p-2 text-ink/50 hover:bg-white/70 hover:text-ink" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      {/* modes */}
      <div className="flex gap-1 px-5 pt-3">
        {(
          [
            { m: "chat", label: "Chat", icon: MessageSquare },
            { m: "talk", label: "Talk", icon: Mic },
            ...(visit ? [{ m: "scribe", label: "Scribe the visit", icon: Radio }] : []),
          ] as { m: Mode; label: string; icon: typeof Mic }[]
        ).map(({ m, label, icon: Icon }) => (
          <button key={m} onClick={() => void setMode(m)} className={cn("flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-light transition-all", s.mode === m ? "bg-white text-ink shadow-[0_0_0_1px_rgba(31,43,41,0.08),0_6px_16px_-8px_rgba(31,43,41,0.3)]" : "text-ink/55 hover:text-ink")}>
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {s.mode === "scribe" && (
        <div className="mx-5 mt-3 rounded-2xl bg-[#fff6e6] px-4 py-2.5 text-[12px] font-light leading-snug text-[#7a5a1c] ring-1 ring-[#f0b45a]/30">
          Recording this consultation with the patient&apos;s agreement. SEAL writes the note as you talk; nothing is saved until you accept it.
        </div>
      )}

      {/* conversation */}
      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {s.messages.length === 0 && s.proposals.length === 0 && (
          <div className="pt-6 text-center">
            <Orb size={84} status={s.live.status === "off" ? "off" : s.live.status} level={s.live.level} />
            <p className="display mt-5 text-[26px] leading-tight">{s.mode === "scribe" ? "Talk with your patient." : s.mode === "talk" ? "I'm listening." : "How can I help?"}</p>
            <p className="mx-auto mt-2 max-w-[300px] text-[13px] font-light text-ink/55">
              {s.mode === "scribe" ? "SEAL listens, writes the note, and tells you what the insurer will ask for while the patient is still here." : s.mode === "talk" ? "Ask anything, or dictate the note. Changes wait for your OK." : "I know this hospital's claims, patients and insurer rules. Changes always wait for your OK."}
            </p>
            {s.mode === "chat" && (
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {suggestions.map((q) => (
                  <button key={q} onClick={() => void send(q)} className="rounded-full bg-white/80 px-3.5 py-2 text-[12.5px] font-light text-ink/75 ring-1 ring-ink/[0.07] transition-colors hover:bg-white hover:text-ink">
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {s.messages.map((m) => (
          <Bubble key={m.id} role={m.role} text={m.text} live={m.live} />
        ))}
        {s.busy && (
          <div className="flex items-center gap-2 text-[12px] font-light text-ink/50">
            <Orb size={18} status="busy" /> Looking into it…
          </div>
        )}
        {s.proposals.map((p) => (
          <ProposalCard key={p.id} p={p} navigate={navigate} />
        ))}
      </div>

      {pending.length > 1 && (
        <div className="flex items-center justify-between border-t border-ink/[0.06] px-5 py-2.5">
          <span className="text-[12px] font-light text-ink/60">{pending.length} changes waiting for you</span>
          <button onClick={() => pending.forEach((p) => void applyProposal(p, navigate))} className="rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-normal text-white">
            Accept all
          </button>
        </div>
      )}

      {/* footer */}
      {s.mode === "chat" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
          className="flex items-center gap-2 border-t border-ink/[0.06] px-4 py-3"
        >
          <button type="button" onClick={() => void setMode("talk")} className="rounded-full p-2.5 text-ink/55 ring-1 ring-ink/10 hover:bg-white hover:text-ink" aria-label="Talk to SEAL">
            <Mic className="size-4" />
          </button>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask SEAL…" className="min-w-0 flex-1 bg-transparent px-1 text-[15px] font-light outline-none placeholder:text-ink/35" />
          <button disabled={!text.trim() || s.busy} className="flex size-9 items-center justify-center rounded-full bg-ink text-white transition-opacity disabled:opacity-30" aria-label="Send">
            <ArrowUp className="size-4" />
          </button>
        </form>
      ) : (
        <LiveBar text={text} setText={setText} send={send} />
      )}
    </motion.aside>
  );
}

function LiveBar({ text, setText, send }: { text: string; setText: (t: string) => void; send: (q: string) => Promise<void> }) {
  const s = useAssistant();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = s.live.startedAt ? Math.max(0, Math.round((now - s.live.startedAt) / 1000)) : 0;
  const label = s.live.status === "connecting" ? "Connecting…" : s.live.status === "listening" ? (s.live.level > 0.04 ? "Hearing you…" : s.mode === "scribe" ? "Listening to the consultation" : "Listening") : s.live.status === "thinking" ? "Got it, thinking…" : s.live.status === "speaking" ? "SEAL is speaking" : s.live.status === "error" ? "Voice is unavailable" : "Voice is off";
  return (
    <div className="border-t border-ink/[0.06] px-5 py-4">
      {s.live.status === "error" && <p className="mb-3 rounded-xl bg-[#c2473c]/10 px-3 py-2 text-[12.5px] text-[#b23b31]">{s.live.error}</p>}
      <div className="flex items-center gap-4">
        <button
          onClick={() => (s.mode === "talk" && (s.live.status === "speaking" || s.live.status === "thinking") ? interruptLive() : undefined)}
          className={cn("rounded-full", s.mode === "talk" && (s.live.status === "speaking" || s.live.status === "thinking") ? "cursor-pointer" : "cursor-default")}
          aria-label={s.live.status === "speaking" ? "Interrupt SEAL" : "SEAL"}
        >
          <Orb size={56} status={s.live.status} level={s.live.level} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-normal">{label}</div>
          {s.mode === "talk" && (s.live.status === "speaking" || s.live.status === "thinking") && <div className="text-[11px] font-light text-ink/45">Tap the orb to interrupt</div>}
          <div className="dot text-[13px] text-ink/45">
            {String(Math.floor(secs / 60)).padStart(2, "0")}:{String(secs % 60).padStart(2, "0")}
          </div>
        </div>
        {s.live.status === "error" ? (
          <button onClick={() => void setMode(s.mode)} className="flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13px] text-white">
            <RotateCw className="size-4" /> Try again
          </button>
        ) : (
          <button onClick={() => void setMode("chat")} className="flex items-center gap-2 rounded-full bg-[#c2473c] px-4 py-2.5 text-[13px] text-white shadow-[0_8px_24px_-8px_rgba(194,71,60,0.6)]">
            <MicOff className="size-4" /> {s.mode === "scribe" ? "End scribe" : "Stop"}
          </button>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
        className="mt-3 flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 ring-1 ring-ink/[0.07]"
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="…or type to SEAL" className="min-w-0 flex-1 bg-transparent px-1 text-[13px] font-light outline-none placeholder:text-ink/35" />
        <button disabled={!text.trim()} className="flex size-7 items-center justify-center rounded-full bg-ink text-white disabled:opacity-30" aria-label="Send">
          <ArrowUp className="size-3.5" />
        </button>
      </form>
    </div>
  );
}

function Bubble({ role, text, live }: { role: "user" | "assistant" | "note"; text: string; live?: boolean }) {
  if (role === "note") return <p className="text-center text-[12px] font-light text-ink/50">{text}</p>;
  if (role === "user")
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
        <div className={cn("max-w-[85%] rounded-[20px] rounded-br-md bg-ink px-4 py-2.5 text-[14px] font-light leading-relaxed text-white", live && "opacity-80")}>
          {text}
          {live && <span className="caret" />}
        </div>
      </motion.div>
    );
  // A nudge from the scribe: what the insurer will need, asked while the patient is still here.
  if (/^\s*ask:/i.test(text))
    return (
      <motion.div initial={{ opacity: 0, x: 12, scale: 0.98 }} animate={{ opacity: 1, x: 0, scale: 1 }} className="rounded-[18px] bg-[#fff3dc] px-4 py-3 ring-1 ring-[#f0b45a]/40 shadow-[0_12px_30px_-18px_rgba(240,180,90,0.8)]">
        <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#a86f0e]">The insurer will ask</div>
        <p className="mt-1 text-[15px] font-normal leading-snug text-[#5c4210]">
          {text.replace(/^\s*ask:\s*/i, "")}
          {live && <span className="caret" />}
        </p>
      </motion.div>
    );
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5">
      <Orb size={22} className="mt-1" />
      <div className={cn("max-w-[88%] text-[14.5px] font-light leading-relaxed text-ink/85", live && "text-ink/70")}>
        <Rich text={text} />
        {live && <span className="caret" />}
      </div>
    </motion.div>
  );
}

// ── Proposal cards: SEAL's suggested changes, waiting for a person ───────────
function ProposalCard({ p, navigate }: { p: Proposal; navigate: (path: string) => void }) {
  const a = p.args as Record<string, string>;
  const view = (() => {
    switch (p.tool) {
      case "update_note":
        return { icon: FileText, title: `Write in “${FIELD[a.field] ?? "the note"}”`, body: <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-[13.5px] font-light italic leading-relaxed text-ink/80">“{a.text}”</p> };
      case "add_diagnosis":
        return { icon: Stethoscope, title: "Add a diagnosis", body: <div className="mt-2 flex flex-wrap items-center gap-2"><CodeChip code={a.icd10} showLabel />{a.reason && <span className="text-[12px] font-light text-ink/55">{a.reason}</span>}</div> };
      case "add_order":
        return { icon: Pill, title: "Order", body: <div className="mt-2 flex flex-wrap items-center gap-2"><CodeChip code={a.code} showLabel />{a.reason && <span className="text-[12px] font-light text-ink/55">{a.reason}</span>}</div> };
      case "remove_order":
        return { icon: Undo2, title: "Remove the order", body: <div className="mt-2"><CodeChip code={a.code} showLabel /></div> };
      case "send_claim":
        return { icon: Send, title: "Send to the insurer", body: <p className="mt-2 text-[13.5px] font-light text-ink/80"><span className="font-mono">{a.claimId}</span>{a.overrideReason ? <span className="mt-1 block text-[12px] text-[#a86f0e]">Held claim, sent with your reason: “{a.overrideReason}”</span> : null}</p> };
      case "send_ready_claims":
        return { icon: Send, title: "Send every ready claim", body: <p className="mt-2 text-[13.5px] font-light text-ink/80">{a.sent ? `${a.sent} claims sent to the insurers` : "All claims that passed SEAL's check go to their insurers."}</p> };
      case "answer_question":
        return { icon: MessageSquare, title: "Answer SEAL's question", body: <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-[13.5px] font-light leading-relaxed text-ink/80"><span className="text-ink/55">{a.label ?? a.field}:</span> <span className="font-normal text-ink">{a.value}</span></p> };
      case "apply_claim_fix":
        return { icon: Wrench, title: "Fix the claim", body: <p className="mt-2 text-[13.5px] font-light text-ink/80">{a.summary ?? "Apply SEAL's recommended fix"}</p> };
      case "recheck_claim":
        return { icon: RotateCw, title: "Check the claim again", body: null };
      case "open_page":
        return { icon: ArrowRight, title: "Go to", body: <p className="mt-1 font-mono text-[12px] text-ink/60">{a.path}</p> };
      default:
        return { icon: Wrench, title: p.tool, body: null };
    }
  })();
  const Icon = view.icon;
  return (
    <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className={cn("rounded-[22px] p-4 ring-1 transition-colors", p.status === "done" ? "bg-seal-mint/30 ring-seal-deep/20" : p.status === "rejected" ? "bg-white/40 opacity-60 ring-ink/[0.06]" : p.status === "failed" ? "bg-[#c2473c]/5 ring-[#c2473c]/20" : "bg-white/75 ring-ink/[0.08] shadow-[0_12px_30px_-18px_rgba(31,43,41,0.35)]")}>
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-seal-mint/60 text-[#237a4b]">
          <Icon className="size-3.5" />
        </span>
        <span className="text-[13.5px] font-normal">{view.title}</span>
        <span className="ml-auto text-[10px] font-light uppercase tracking-[0.18em] text-ink/40">{p.status === "pending" ? "Suggested" : p.status === "working" ? "Applying" : p.status === "done" ? "Done" : p.status === "rejected" ? "Rejected" : "Couldn't"}</span>
      </div>
      {view.body}
      {p.note && <p className="mt-2 text-[12px] text-[#b23b31]">{p.note}</p>}
      {(p.status === "pending" || p.status === "failed") && (
        <div className="mt-3 flex gap-2">
          <button onClick={() => void applyProposal(p, navigate)} className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[12.5px] text-white">
            <Check className="size-3.5" /> Accept
          </button>
          <button onClick={() => assistant.updateProposal(p.id, { status: "rejected" })} className="rounded-full px-4 py-2 text-[12.5px] font-light text-ink/60 ring-1 ring-ink/10 hover:bg-white">
            Reject
          </button>
        </div>
      )}
      {p.status === "done" && (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] font-light text-[#237a4b]">
          <Check className="size-3.5" /> {p.tool === "send_claim" || p.tool === "send_ready_claims" ? "Sent — the insurer's answer will arrive in Claims" : p.tool === "answer_question" ? "Saved as a draft answer — the doctor signs it" : p.tool === "update_note" ? "Written into the note" : p.tool.startsWith("add") ? "Added — SEAL is checking it" : "Done"}
        </p>
      )}
    </motion.div>
  );
}

/** Assistant text: paragraphs, "- " bullet lines and **bold** numbers. */
function Rich({ text }: { text: string }) {
  const bold = (t: string) => t.split(/(\*\*[^*]+\*\*)/g).map((x, i) => (x.startsWith("**") && x.endsWith("**") ? <b key={i} className="font-semibold text-ink">{x.slice(2, -2)}</b> : <span key={i}>{x}</span>));
  const lines = text.split(/\n+/).filter((l) => l.trim());
  return (
    <div className="space-y-1.5">
      {lines.map((l, i) =>
        /^\s*[-•*]\s+/.test(l) ? (
          <div key={i} className="flex gap-2">
            <span className="mt-[9px] size-1 shrink-0 rounded-full bg-seal-deep" />
            <span>{bold(l.replace(/^\s*[-•*]\s+/, ""))}</span>
          </div>
        ) : (
          <p key={i}>{bold(l)}</p>
        ),
      )}
    </div>
  );
}
