"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Mic, MicOff, Radio, RotateCw, X, MessageSquare } from "lucide-react";
import { Orb } from "./orb";
import { assistant, useAssistant, type Mode } from "./store";
import { applyProposal } from "./apply";
import { OfferCard, ProposalCard, Rich } from "./cards";
import { contextNow, runActions, setNavigator } from "./screen";
import { interruptLive, sendLiveText, setPanelMode, startVoice } from "./voice-control";
import { Voice } from "./voice";
import { Travel } from "./travel";
import { cn } from "@/lib/utils";

/**
 * SEAL's assistant has one way in: the S at the bottom centre (⌘J), a voice assistant (./voice).
 * When someone wants more detail, the voice bar opens this glass panel ("Open in chat", or ⌘K):
 * the same conversation as text, with typed chat and the consultation scribe. Anything that would
 * change a record arrives as a proposal card; moving around SEAL happens at once.
 */
const HIDDEN = ["/", "/select"];
export function Assistant() {
  const pathname = usePathname();
  const router = useRouter();
  const s = useAssistant();

  useEffect(() => {
    setNavigator({ push: (p) => router.push(p as never), back: () => router.back() });
  }, [router]);
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
  // Leaving the visit ends the scribe (it belongs to that consultation). Talk keeps going: SEAL
  // moves people between screens while they talk.
  useEffect(() => {
    if (assistant.get().mode === "scribe") void setPanelMode("chat");
  }, [pathname]);

  if (HIDDEN.includes(pathname)) return null;

  return (
    <>
      <AnimatePresence>{s.open && <Panel key="panel" navigate={(p) => router.push(p as never)} />}</AnimatePresence>
      <Voice />
      <Suspense>
        <Travel />
      </Suspense>
    </>
  );
}

const setMode = (mode: Mode) => (mode === "talk" ? startVoice() : setPanelMode(mode));

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
      const r = await fetch("/api/assistant/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history, context: contextNow() }) }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      if (r.reply) assistant.say({ role: "assistant", text: r.reply });
      for (const p of r.proposals ?? []) assistant.propose(p.tool, p.args, p.id);
      // moving around SEAL, "take me there?", or a change they typed yes to
      if (r.actions?.length) await runActions(r.actions);
    } catch (e) {
      const m = (e as Error).message;
      assistant.say({ role: "note", text: /429|quota|rate limit|RESOURCE_EXHAUSTED|503|UNAVAILABLE|over capacity/i.test(m) ? "SEAL's AI is busy right now (its usage limit was reached). Please try again in a minute." : `SEAL could not answer: ${m.slice(0, 140)}` });
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
        // Phones: a sheet over the lower part of the screen (the page stays visible above it). Desktop: a side panel.
        "fixed inset-x-2 bottom-[calc(76px+env(safe-area-inset-bottom))] h-[min(58dvh,520px)] z-[60] flex flex-col overflow-hidden rounded-[28px] md:inset-x-auto md:bottom-6 md:right-6 md:top-[76px] md:h-auto",
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
          <div className="pt-3 text-center md:pt-6">
            {/* Smaller on phones, where the panel is a short sheet. */}
            <div className="mx-auto w-fit origin-top scale-[0.62] -mb-7 md:mb-0 md:scale-100">
              <Orb size={84} status={s.live.status === "off" ? "off" : s.live.status} level={s.live.level} />
            </div>
            <p className="display mt-3 text-[22px] leading-tight md:mt-5 md:text-[26px]">{s.mode === "scribe" ? "Talk with your patient." : s.mode === "talk" ? "I'm listening." : "How can I help?"}</p>
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
        {s.offer?.status === "open" && <OfferCard o={s.offer} />}
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
