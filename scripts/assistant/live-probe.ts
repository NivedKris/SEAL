/**
 * Ask the live voice model (Gemini Live, as the voice bar uses it) typed sentences and print what
 * it does: every tool call, where it would navigate, and what it says. Uses the running dev server
 * for the session token and the look-ups, and today's real clinic list as the screen.
 *   npx tsx scripts/assistant/live-probe.ts [basic|apollo] "sentence" "sentence" …
 */
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { pathFor, type Destination } from "../../lib/assistant/sitemap";

const BASE = process.env.SEAL_URL ?? "http://localhost:3000";
const tenant = process.argv[2] ?? "basic";
const sentences = process.argv.slice(3);
const headers = { "content-type": "application/json", cookie: `seal-tenant=${tenant}` };
const post = (url: string, body: unknown) => fetch(BASE + url, { method: "POST", headers, body: JSON.stringify(body) }).then((r) => r.json());
const get = (url: string) => fetch(BASE + url, { headers }).then((r) => r.json());

const NUDGE = "(The results of your last action are in. Now tell the person, in one or two short sentences, what you did or found.)";
type Item = { id: string; label: string; kind?: string };
async function screen() {
  const { encounters } = await get("/api/encounters?status=open");
  const items: Item[] = encounters.slice(0, 40).map((x: { _id: string; patientName: string; providerName: string; providerId: string }) => ({ id: x._id, kind: "visit", label: `${x.patientName} · ${x.providerName} (doctor id ${x.providerId})` }));
  const first = process.env.VISIT ? { _id: process.env.VISIT } : encounters[0];
  const v = await get(`/api/emr/encounters/${first._id}`);
  const chk = await post(`/api/encounters/${first._id}/check`, { mode: "rules", note: { complaint: v.encounter.complaint, findings: v.encounter.findings, plan: v.encounter.plan ?? "" } });
  const details = [
    `Open visit: ${v.patient.name} with ${v.provider.name}, ${v.insurance.payer}. Visit id ${first._id}.`,
    `SEAL's check (the panel on the right): ${(chk.orders ?? []).map((o: { label: string; code: string; status: string; cards: { title: string; kind: string; denialCode: string; insurerNeeds: string; missing: { text: string }[]; fixActions: string[]; fixTemplates: string[] }[] }) => `${o.label} ${o.code}: ${o.status === "at_risk" ? `AT RISK${o.cards.map((c) => ` — ${c.title} (would be refused as ${c.denialCode}); insurer needs: ${c.insurerNeeds}; missing: ${c.missing.map((m) => m.text).join(", ")}; fixes on the card: ${c.fixActions.join(", ")}${c.kind === "documentation" ? `; note template(s) whose ____ blanks the doctor must fill: ${c.fixTemplates.join(" / ")}` : ""}`).join("")}` : "supported by the note"}${(() => { const pa = (v.priorAuths ?? []).find((p: { codes: string[] }) => p.codes.includes(o.code)); return !pa ? " (no prior approval on file for this order)" : pa.validTo < v.encounter.start.slice(0, 10) ? ` (the approval on file, ${pa.authNo}, EXPIRED on ${pa.validTo}, before this visit: it does not count)` : ` (a valid prior approval, ${pa.authNo}, is on file)`; })()}`).join(". ")}`,
    (v.priorAuths ?? []).length ? `Prior approvals on file for this patient (each covers ONLY the codes listed): ${v.priorAuths.map((p: { authNo: string; codes: string[] }) => `${p.authNo} covers ${p.codes.join(", ")}, valid to ${(p as { validTo?: string }).validTo}`).join("; ")}.` : "No prior approvals on file.",
  ].join("\n");
  return { path: "/emr", encounterId: first._id as string, screen: { title: "Patients · everyone's clinic today", items, details } };
}

async function ask(ctx: Awaited<ReturnType<typeof screen>>, sentence: string) {
  const turns = sentence.split(" | ").slice(1);
  sentence = sentence.split(" | ")[0];
  const setup = await post("/api/assistant/token", { context: ctx, mode: "talk" });
  if (setup.error) throw new Error(setup.error);
  const ai = new GoogleGenAI({ apiKey: setup.token, httpOptions: { apiVersion: "v1alpha" } });
  const log: string[] = [];
  let said = "";
  let session: Session | null = null;
  const t0 = Date.now();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => resolve(), 45000 * (turns.length + 1));
    const onTools = async (m: LiveServerMessage) => {
      const responses: { id?: string; name: string; response: Record<string, unknown> }[] = [];
      for (const fc of m.toolCall!.functionCalls ?? []) {
        const name = fc.name!;
        const args = (fc.args ?? {}) as Record<string, unknown>;
        let response: Record<string, unknown>;
        if (name === "navigate" || name === "offer_navigation") {
          const to = pathFor(args as unknown as Destination);
          log.push(`${name} → ${"error" in to ? `ERROR ${to.error}` : to.path}`);
          response = "error" in to ? { error: to.error } : name === "navigate" ? { status: `Opened ${to.label} on the person's screen. Say in one short sentence what is there now.` } : { status: `A "Take me there" button for ${to.label} is on screen. Ask whether to take them; if they say yes, call navigate with the same destination.` };
        } else if (name === "get_screen") {
          log.push("get_screen");
          response = { ...ctx.screen, items: ctx.screen.items.map((x, i) => ({ n: i + 1, ...x })) };
        } else if (name === "show_details") {
          log.push(`show_details (${String(args.text).length} chars)`);
          response = { status: "Shown on screen. Now say a short summary out loud." };
        } else if (["go_back", "confirm_change", "reject_change"].includes(name)) {
          log.push(name);
          response = { status: "done" };
        } else if (["update_note", "add_diagnosis", "add_order", "remove_order", "request_prior_approval", "apply_recovery_fix", "draft_recovery_letter", "resubmit_claim", "answer_question", "apply_claim_fix", "send_claim", "send_ready_claims", "recheck_claim"].includes(name)) {
          log.push(`propose ${name} ${JSON.stringify(args).slice(0, 100)}`);
          response = { status: "Proposed (nothing changed yet). Ask whether to go ahead.", proposalId: "p1" };
        } else {
          const r = await post("/api/assistant/tool", { name, args, context: ctx });
          log.push(`${name}(${JSON.stringify(args).slice(0, 80)}) → ${JSON.stringify(r.result ?? r).slice(0, 140)}`);
          response = { result: r.result ?? r };
        }
        responses.push({ id: fc.id, name, response });
      }
      // Hold the reply until the model has closed the turn that asked for it (see live.ts).
      const send = () => {
        session?.sendToolResponse({ functionResponses: responses });
        afterTool = true;
      };
      if (process.env.HOLD && !turnClosed) {
        const t = Date.now();
        const wait = () => (turnClosed || Date.now() - t > 1500 ? send() : setTimeout(wait, 20));
        wait();
      } else send();
    };
    let turnClosed = false;
    let afterTool = false;
    let nudged = false;
    ai.live
      .connect({
        model: process.env.MODEL ?? setup.models[0],
        config: { responseModalities: [Modality.AUDIO], outputAudioTranscription: {}, speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: setup.voice } } }, systemInstruction: setup.systemInstruction, tools: [{ functionDeclarations: setup.tools }] },
        callbacks: {
          onmessage: (m) => {
            if (process.env.DEBUG) {
              const keys = Object.keys(m).filter((k) => (m as unknown as Record<string, unknown>)[k] != null);
              const sc = m.serverContent ? Object.keys(m.serverContent).filter((k) => (m.serverContent as unknown as Record<string, unknown>)[k] != null) : [];
              const audio = m.serverContent?.modelTurn?.parts?.some((p) => p.inlineData) ? " +audio" : "";
              log.push(`  ·${((Date.now() - t0) / 1000).toFixed(1)}s ${keys.join(",")}${sc.length ? `[${sc.join(",")}]` : ""}${audio}`);
            }
            if (m.toolCall) turnClosed = false;
            if (m.serverContent?.turnComplete || m.serverContent?.generationComplete) turnClosed = true;
            if (m.setupComplete) setTimeout(() => session?.sendRealtimeInput({ text: sentence }), 50);
            if (m.toolCall) void onTools(m);
            if (m.serverContent?.outputTranscription?.text) said += m.serverContent.outputTranscription.text;
            // Acted but went quiet: ask it to say what it did (what the app does too).
            if (m.serverContent?.turnComplete && afterTool && !said && !nudged) {
              nudged = true;
              log.push("(nudged)");
              setTimeout(() => session?.sendRealtimeInput({ text: NUDGE }), 300);
            }
            if (m.serverContent?.turnComplete && said) {
              const next = turns.shift();
              if (next) {
                log.push(`  (${said.trim().replace(/\s+/g, " ").slice(0, 260)})`);
                log.push(`» ${next}`);
                said = "";
                afterTool = nudged = false;
                setTimeout(() => session?.sendRealtimeInput({ text: next }), 300);
              } else {
                clearTimeout(timer);
                resolve();
              }
            }
          },
          onerror: (e) => reject(new Error(String((e as { message?: string }).message ?? e))),
          onclose: () => resolve(),
        },
      })
      .then((s) => (session = s))
      .catch(reject);
  });
  (session as Session | null)?.close();
  console.log(`\n» ${sentence}   (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (const l of log) console.log(`   ${l}`);
  console.log(`   says: ${said.trim().replace(/\s+/g, " ").slice(0, 300) || "(nothing)"}`);
}

async function main() {
  // CLAIM=clm-…: talk about that claim (its page open) instead of a visit
  const ctx = process.env.CLAIM ? { path: `/billing/claims/${process.env.CLAIM}`, claimId: process.env.CLAIM, encounterId: undefined as unknown as string, screen: { title: `Claim ${process.env.CLAIM}`, items: [] as Item[], details: "" } } : await screen();
  console.log(`screen: ${ctx.screen.items.length} patients listed; open visit ${ctx.encounterId}`);
  for (const s of sentences) await ask(ctx, s).catch((e) => console.log(`\n» ${s}\n   ERROR ${(e as Error).message}`));
}
void main();
