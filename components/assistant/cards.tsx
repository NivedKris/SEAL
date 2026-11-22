"use client";

import { motion } from "motion/react";
import { ArrowRight, Check, FileText, MessageSquare, Pill, RotateCw, Send, ShieldCheck, Stethoscope, Undo2, Wrench, X } from "lucide-react";
import { assistant, type Offer, type Proposal } from "./store";
import { applyProposal } from "./apply";
import { go } from "./screen";
import { CodeChip } from "@/components/shared/code-chip";
import { cn } from "@/lib/utils";

/** Cards shared by the assistant panel and the voice bar: proposed changes, "Take me there?", rich text. */
const FIELD: Record<string, string> = { complaint: "What the patient says", findings: "What you found", plan: "Plan" };

/** SEAL's suggested change, waiting for a person (Accept / Reject, or a spoken yes). */
export function ProposalCard({ p, navigate }: { p: Proposal; navigate: (path: string) => void }) {
  const a = p.args as Record<string, string>;
  const view = (() => {
    switch (p.tool) {
      case "update_note":
        return { icon: FileText, title: `Write in “${FIELD[a.field] ?? "the note"}”`, body: <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-[13.5px] font-light italic leading-relaxed text-ink/80">“{a.text}”</p> };
      case "add_diagnosis":
        return { icon: Stethoscope, title: "Add a diagnosis", body: <div className="mt-2 flex flex-wrap items-center gap-2"><CodeChip code={a.icd10} showLabel />{a.reason && <span className="text-[12px] font-light text-ink/55">{a.reason}</span>}</div> };
      case "add_order":
        return { icon: Pill, title: "Order", body: <div className="mt-2 flex flex-wrap items-center gap-2"><CodeChip code={a.code} showLabel />{a.reason && <span className="text-[12px] font-light text-ink/55">{a.reason}</span>}</div> };
      case "request_prior_approval":
        return { icon: ShieldCheck, title: "Request the insurer's prior approval", body: <div className="mt-2 flex flex-wrap items-center gap-2"><CodeChip code={a.code} showLabel />{a.authNo && <span className="text-[12px] font-light text-[#237a4b]">Approved · {a.authNo}{a.validTo ? ` · valid to ${a.validTo}` : ""}</span>}</div> };
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
      case "apply_recovery_fix":
        return { icon: RotateCw, title: ({ request_prior_auth: "Get the insurer's approval", attach_auth: "Attach the approval", set_quantity: "Bill the approved quantity", add_diagnosis: "Add a diagnosis", remove_diagnosis: "Remove a diagnosis", write_off: "Write the line off" } as Record<string, string>)[a.fix] ?? "Fix the refused line", body: <p className="mt-2 text-[13.5px] font-light text-ink/80">{a.summary ?? [a.code, a.authNo, a.quantity && `quantity ${a.quantity}`, a.activityId && `line ${a.activityId}`].filter(Boolean).join(" · ")}</p> };
      case "draft_recovery_letter":
        return { icon: FileText, title: "Draft the appeal letter", body: <p className="mt-2 text-[13.5px] font-light text-ink/80">SEAL writes it from the note&apos;s own words; you can edit it on the claim.</p> };
      case "resubmit_claim":
        return { icon: Send, title: "Resubmit to the insurer", body: <p className="mt-2 text-[13.5px] font-light text-ink/80">With the fixes and the letter prepared on the claim{a.type ? ` (${a.type})` : ""}.</p> };
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
          <Check className="size-3.5" /> {p.tool === "send_claim" || p.tool === "send_ready_claims" ? "Sent — the insurer's answer will arrive in Claims" : p.tool === "answer_question" ? "Saved as a draft answer — the doctor signs it" : p.tool === "update_note" ? "Written into the note" : p.tool === "request_prior_approval" ? "Requested — SEAL is checking the order again" : p.tool === "apply_recovery_fix" ? "Applied to the resubmission" : p.tool === "draft_recovery_letter" ? "Drafted — it's on the claim, ready to edit" : p.tool === "resubmit_claim" ? "Resubmitted — the insurer's answer will arrive in Claims" : p.tool.startsWith("add") ? "Added — SEAL is checking it" : "Done"}
        </p>
      )}
    </motion.div>
  );
}

/** Assistant text: paragraphs, "- " bullet lines and **bold** numbers. */
export function Rich({ text }: { text: string }) {
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

/** "Take me there?": a place SEAL offered to open. Yes opens it; No puts it away. */
export function OfferCard({ o }: { o: Offer }) {
  const take = () => {
    assistant.set({ offer: { ...o, status: "taken" } });
    go(o.path, o.label);
  };
  return (
    <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="rounded-[22px] bg-white/80 p-4 ring-1 ring-ink/[0.08] shadow-[0_12px_30px_-18px_rgba(31,43,41,0.35)]">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-seal-mint/60 text-[#237a4b]">
          <ArrowRight className="size-3.5" />
        </span>
        <span className="text-[13.5px] font-normal">{o.label}</span>
      </div>
      <p className="mt-2 text-[13.5px] font-light leading-snug text-ink/75">{o.question}</p>
      <div className="mt-3 flex gap-2">
        <button onClick={take} className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[12.5px] text-white">
          <ArrowRight className="size-3.5" /> Take me there
        </button>
        <button onClick={() => assistant.set({ offer: { ...o, status: "declined" } })} className="flex items-center gap-1 rounded-full px-4 py-2 text-[12.5px] font-light text-ink/60 ring-1 ring-ink/10 hover:bg-white">
          <X className="size-3.5" /> Not now
        </button>
      </div>
    </motion.div>
  );
}
