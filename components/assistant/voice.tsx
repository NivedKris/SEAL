"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MessageSquareText, RotateCw, X } from "lucide-react";
import { Orb } from "./orb";
import { assistant, useAssistant } from "./store";
import { OfferCard, ProposalCard, Rich } from "./cards";
import { go } from "./screen";
import { interruptLive, openChat, startVoice, stopVoice } from "./voice-control";
import { cn } from "@/lib/utils";

/**
 * SEAL's voice, Siri-style: the S at the bottom centre of every screen. Tap it (or ⌘J) and talk;
 * the screen's edge glows while SEAL listens, your words and SEAL's reply show in a glass bar, and
 * anything SEAL wants to show or do (a breakdown, "Take me there?", a change to confirm) appears as
 * a card above the bar. It keeps listening as SEAL moves you between screens.
 */
export function Voice() {
  const s = useAssistant();
  const on = s.voice.on;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        void (assistant.get().voice.on ? stopVoice() : startVoice());
      }
      if (e.key === "Escape" && assistant.get().voice.on) void stopVoice();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <EdgeGlow />
      <AnimatePresence>
        {!on && !s.open && (
          <motion.button
            key="voice-orb"
            initial={{ opacity: 0, y: 16, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            onClick={() => void startVoice()}
            className="group fixed bottom-[calc(82px+env(safe-area-inset-bottom))] left-1/2 z-[60] -translate-x-1/2 md:bottom-6"
            aria-label="Talk to SEAL (Ctrl+J)"
          >
            <span className="pointer-events-none absolute inset-[-10px] rounded-full bg-[radial-gradient(circle,rgba(62,207,127,0.35),rgba(191,240,214,0.15)_45%,transparent_70%)] blur-md transition-opacity group-hover:opacity-100 opacity-70" />
            <Orb size={54} status="off" />
            <span className="pointer-events-none absolute bottom-[66px] left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-white/85 px-3 py-1.5 text-[12px] font-light text-ink/70 opacity-0 shadow-sm ring-1 ring-ink/[0.07] backdrop-blur transition-opacity group-hover:opacity-100 md:block">
              Talk to SEAL · <kbd className="font-sans">⌘J</kbd> · chat <kbd className="font-sans">⌘K</kbd>
            </span>
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>{on && <Bar key="voice-bar" />}</AnimatePresence>
    </>
  );
}

/** The screen's edge, glowing with SEAL: mint while listening (with your voice), amber while thinking. */
function EdgeGlow() {
  const s = useAssistant();
  const on = s.voice.on && s.live.status !== "off" && s.live.status !== "error";
  const thinking = s.live.status === "thinking" || s.live.status === "connecting";
  const k = 0.45 + Math.min(1, s.live.level * 1.6) * 0.55;
  const c1 = thinking ? "240,180,90" : "62,207,127";
  const c2 = thinking ? "255,226,170" : "160,220,255";
  return (
    <AnimatePresence>
      {on && (
        <motion.div
          key="edge"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className={cn("pointer-events-none fixed inset-0 z-[55]", thinking && "edge-breathe")}
          style={{
            boxShadow: `inset 0 0 ${26 + 30 * k}px ${4 + 6 * k}px rgba(${c1},${0.35 * k}), inset 0 0 ${90 + 60 * k}px ${10 + 20 * k}px rgba(${c2},${0.22 * k})`,
            transition: "box-shadow 120ms linear",
          }}
        />
      )}
    </AnimatePresence>
  );
}

function Bar() {
  const s = useAssistant();

  const mine = s.messages.slice(s.voice.from);
  const lastUserIdx = mine.map((m) => m.role).lastIndexOf("user");
  const you = lastUserIdx >= 0 ? mine[lastUserIdx] : null;
  const after = mine.slice(lastUserIdx + 1);
  const said = [...after].reverse().find((m) => (m.role === "assistant" && !m.detail) || m.role === "note");
  const detail = [...after].reverse().find((m) => m.role === "assistant" && m.detail);
  const cards = s.proposals.slice(s.voice.fromProposal).filter((p) => p.status !== "rejected").slice(-2);
  const offer = s.offer?.status === "open" ? s.offer : null;

  const st = s.live.status;
  const label = st === "connecting" ? "Connecting…" : st === "listening" ? (s.live.level > 0.04 ? "Hearing you…" : "Listening") : st === "thinking" ? "Thinking…" : st === "speaking" ? "SEAL" : st === "error" ? "Voice is unavailable" : "Voice is off";
  const showYou = you && (st === "listening" || st === "thinking" || !said);
  const caption = st === "error" ? s.live.error : showYou ? you!.text : said?.text;


  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.96 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="fixed bottom-[calc(78px+env(safe-area-inset-bottom))] left-1/2 z-[61] w-[min(640px,calc(100vw-20px))] -translate-x-1/2 md:bottom-6"
    >
      {/* What SEAL is showing: a breakdown, a place to go, a change to confirm */}
      <div className="mb-2.5 max-h-[min(52vh,520px)] space-y-2.5 overflow-y-auto overscroll-contain px-0.5 pb-0.5">
        <AnimatePresence initial={false}>
          {detail && (
            <motion.div key={detail.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-[22px] bg-white/85 px-5 py-4 text-[14px] font-light leading-relaxed text-ink/85 ring-1 ring-ink/[0.07] shadow-[0_18px_40px_-24px_rgba(31,43,41,0.45)] backdrop-blur-2xl">
              <Rich text={detail.text} />
              <button onClick={() => void openChat()} className="mt-2 text-[12px] font-normal text-seal-deep hover:underline">
                Open in chat for more →
              </button>
            </motion.div>
          )}
          {offer && (
            <div key={offer.id}>
              <OfferCard o={offer} />
            </div>
          )}
          {cards.map((p) => (
            <div key={p.id} className="backdrop-blur-2xl">
              <ProposalCard p={p} navigate={go} />
            </div>
          ))}
        </AnimatePresence>
      </div>

      {/* The bar */}
      <div className="relative">
        <div className="voice-halo pointer-events-none absolute -inset-[3px] rounded-[30px] opacity-80 blur-[6px]" />
        <div className="relative flex items-center gap-3 rounded-[28px] bg-[#f6faf8]/90 py-2.5 pl-2.5 pr-3 ring-1 ring-white/70 shadow-[0_24px_60px_-24px_rgba(31,43,41,0.5)] backdrop-blur-2xl">
          <button
            onClick={() => (st === "speaking" || st === "thinking" ? interruptLive() : undefined)}
            className={cn("shrink-0 rounded-full", st === "speaking" || st === "thinking" ? "cursor-pointer" : "cursor-default")}
            aria-label={st === "speaking" ? "Interrupt SEAL" : "SEAL"}
          >
            <Orb size={46} status={st} level={s.live.level} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.2em] text-ink/45">
              {label}
              {(st === "speaking" || st === "thinking") && <span className="hidden normal-case tracking-normal font-light text-ink/35 sm:inline">· tap the S to interrupt</span>}
            </div>
            <p className={cn("mt-0.5 line-clamp-2 text-[15px] leading-snug", showYou ? "font-light text-ink/60" : "font-normal text-ink/90", st === "error" && "text-[13px] text-[#b23b31]")}>
              {caption || (st === "listening" ? "Ask anything, or say where to go" : " ")}
              {(you?.live || said?.live) && <span className="caret" />}
            </p>
          </div>
          {st === "error" ? (
            <button onClick={() => void stopVoice().then(startVoice)} className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[12.5px] text-white">
              <RotateCw className="size-3.5" /> Retry
            </button>
          ) : (
            <button onClick={() => void openChat()} className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-2 text-[12px] font-light text-ink/50 hover:bg-white hover:text-ink" aria-label="Open in chat for more detail" title="More detail: open in chat (⌘K)">
              <MessageSquareText className="size-4" />
              <span className="hidden sm:inline">Open in chat</span>
            </button>
          )}
          <button onClick={() => void stopVoice()} className="shrink-0 rounded-full p-2 text-ink/45 hover:bg-white hover:text-ink" aria-label="Stop talking to SEAL">
            <X className="size-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
