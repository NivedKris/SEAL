/**
 * The assistant test set: real phrasings → the action SEAL should take. Runs the same instructions
 * and tools as the voice and chat assistant (typed path) against Apollo's data.
 *   npm run assistant:eval            (Gemini, closest to the live voice model)
 *   ENGINE=groq npm run assistant:eval
 *   ONLY=nav-3,offer-1 npm run assistant:eval
 */
import { tenantDb, mongoClient } from "@/lib/db/mongo";
import { runAgent, type AgentResult, type ChatMsg } from "@/lib/assistant/agent";
import { namesHint, systemInstruction, type AssistantContext } from "@/lib/assistant/tools";

type Case = { id: string; say: string | ChatMsg[]; ctx?: Partial<AssistantContext>; expect: (r: AgentResult) => true | string };

const navs = (r: AgentResult) => r.actions.filter((a) => a.tool === "navigate");
const offers = (r: AgentResult) => r.actions.filter((a) => a.tool === "offer_navigation");
const path = (r: AgentResult) => String(navs(r).at(-1)?.args.path ?? "");
const goes = (test: (p: string) => boolean, what: string) => (r: AgentResult) => (navs(r).length && test(path(r)) ? true : `expected to go to ${what}; went to "${path(r) || "nowhere"}"${offers(r).length ? " (offered instead)" : ""}`);
const offersTo = (test: (p: string) => boolean, what: string) => (r: AgentResult) => {
  if (navs(r).length) return `should only offer ${what}, but navigated to ${path(r)}`;
  const o = offers(r).at(-1);
  return o && test(String(o.args.path)) ? true : `expected "Take me there?" for ${what}; got ${o ? o.args.path : "no offer"}`;
};
const list = (min: number, max: number) => (r: AgentResult) => {
  const n = String(navs(r).at(-1)?.args.path ?? "").match(/ids=([^&]+)/)?.[1]?.split(/%2C|,/).length ?? 0;
  return navs(r).length && n >= min && n <= max ? true : `expected a list of ${min}-${max} claims on Claims; got "${path(r) || "nothing"}" (${n})`;
};
const stays = (also?: (r: AgentResult) => true | string) => (r: AgentResult) => (navs(r).length ? `should answer, not navigate (went to ${path(r)})` : also ? also(r) : true);
const used = (tool: string) => (r: AgentResult) => (r.looked.includes(tool) ? true : `expected ${tool}; looked at ${r.looked.join(", ") || "nothing"}`);
const tab = (t: string) => (p: string) => p.startsWith("/billing") && p.includes(`tab=${t}`);
const proposes = (tool: string) => (r: AgentResult) => (r.proposals.some((p) => p.tool === tool) ? (r.actions.some((a) => a.tool === "confirm_change") ? "confirmed on its own" : true) : `expected a ${tool} proposal; got ${r.proposals.map((p) => p.tool).join(", ") || "none"}`);

const billing = { path: "/billing", screen: { title: "Claims", tab: "Needs attention", items: [ { id: "clm-L000001", kind: "claim", label: "SSH-L000001 · Mark Mendoza · Sukoon · hold · AED 640" }, { id: "clm-L000004", kind: "claim", label: "SSH-L000004 · Saima Sheikh · Orient · hold · AED 1210" }, { id: "clm-L000014", kind: "claim", label: "SSH-L000014 · Rekha Pillai · Qatar · hold · AED 380" } ] } };
const emr = { path: "/emr", screen: { title: "Patients · everyone's clinic today", items: [ { id: "enc-T-0306", kind: "visit", label: "Mark Mendoza · 10:05 · Gee George (doctor id dr-nadia-haddad)" }, { id: "enc-T-0506", kind: "visit", label: "Saima Sheikh · 10:20 · Puthiya Chelantakath (doctor id dr-hessa-alameri)" }, { id: "enc-T-0606", kind: "visit", label: "Rekha Pillai · 10:35 · Meera Tripathi (doctor id dr-mariam-tahir)" } ] } };
const pending = { path: "/billing/claims/clm-L000004", claimId: "clm-L000004", pending: [{ id: "p1", tool: "send_claim", args: { claimId: "clm-L000004" } }] };
const offerTurn = (answer: string): ChatMsg[] => [
  { role: "user", text: "Where can I find the refused claims?" },
  { role: "assistant", text: "They are under Claims, on the Refused tab. Shall I take you there?" },
  { role: "user", text: answer },
];

const CASES: Case[] = [
  // Commands: go now
  { id: "nav-1", say: "Take me to my previous 10 claims", expect: list(8, 10) },
  { id: "nav-2", say: "Show me the refused claims", expect: goes(tab("refused"), "Claims · Refused") },
  { id: "nav-3", say: "Open claim L4", expect: goes((p) => p === "/billing/claims/clm-L000004", "claim L000004") },
  { id: "nav-4", say: "Go to finance", expect: goes((p) => p === "/clinic", "Finance") },
  { id: "nav-5", say: "Take me to insights", expect: goes((p) => p === "/ai-health", "Insights") },
  { id: "nav-6", say: "Open the insurer rules", expect: goes((p) => p === "/rules", "Rules") },
  { id: "nav-7", say: "Show me Gee George's patients", expect: goes((p) => p.startsWith("/emr") && p.includes("providerId=dr-nadia-haddad"), "Gee George's patients") },
  { id: "nav-8", say: "Pull up Mark Mendoza's visit", expect: goes((p) => p.startsWith("/emr") && p.includes("e=enc-T-0306"), "Mark Mendoza's visit") },
  { id: "nav-9", say: "Show me the claims that are ready to send", expect: goes(tab("ready"), "Claims · Ready") },
  { id: "nav-10", say: "Take me home", expect: goes((p) => p === "/today", "Today") },
  { id: "nav-11", say: "Show me what's with the insurer right now", expect: goes(tab("submitted"), "Claims · With the insurer") },
  { id: "nav-12", say: "Open the doctor questions", expect: goes((p) => p.startsWith("/doctor"), "Questions") },
  { id: "nav-13", say: "Show me the paid claims", expect: goes(tab("paid"), "Claims · Paid") },
  { id: "nav-14", say: "Show me the claims on hold", expect: goes(tab("hold"), "Claims · Needs attention") },
  { id: "nav-15", say: "Show me our Sukoon claims", expect: list(1, 50) },
  { id: "nav-16", say: "Show me the five biggest claims", expect: list(1, 5) },
  { id: "nav-17", say: "Open Naved Iqbal's questions", expect: goes((p) => p.startsWith("/doctor") && p.includes("providerId=dr-omar-haddad"), "Naved Iqbal's questions") },
  { id: "nav-18", say: "Show me the claims from the last 7 days", expect: list(1, 50) },
  { id: "nav-19", say: "I want to see the dashboard", ctx: { path: "/billing" }, expect: goes((p) => p === "/today", "Today") },
  { id: "nav-20", say: "Go to settings", expect: goes((p) => p === "/admin", "Settings") },
  { id: "nav-21", say: "Take me to Saima Sheikh", expect: goes((p) => p.startsWith("/emr") && p.includes("e=enc-T-0506"), "Saima Sheikh's visit") },
  { id: "nav-22", say: "Show me my last 3 paid claims", expect: list(1, 3) },
  { id: "nav-23", say: "Open the latest claim", expect: (r) => (goes((p) => p.startsWith("/billing/claims/"), "one claim")(r) === true || list(1, 1)(r) === true ? true : `expected the latest claim; went to ${path(r) || "nowhere"}`) },
  { id: "nav-24", say: "Show me the appeals that are due", expect: (r) => (path(r).includes("tab=refused") ? true : `expected Claims · Refused; went to ${path(r) || "nowhere"}`) },
  // Questions: answer and offer
  { id: "offer-1", say: "Where can I find all the refused claims?", expect: offersTo(tab("refused"), "Claims · Refused") },
  { id: "offer-2", say: "Where do I see how much money we've lost?", expect: offersTo((p) => p === "/clinic", "Finance") },
  { id: "offer-3", say: "Where are the questions for the doctors?", expect: offersTo((p) => p.startsWith("/doctor"), "Questions") },
  { id: "offer-4", say: "How do I get to the insurer rules?", expect: offersTo((p) => p === "/rules", "Rules") },
  { id: "offer-5", say: "Where can I see how accurate SEAL is?", expect: offersTo((p) => p === "/ai-health", "Insights") },
  { id: "offer-6", say: "Where would I find the claims waiting to be sent?", expect: offersTo(tab("ready"), "Claims · Ready") },
  // Follow-ups
  { id: "follow-yes", say: offerTurn("Yes please"), expect: goes(tab("refused"), "Claims · Refused") },
  { id: "follow-no", say: offerTurn("No thanks, not now"), expect: stays() },
  // What is on screen
  { id: "screen-1", say: "Open the second one", ctx: billing, expect: goes((p) => p === "/billing/claims/clm-L000004", "the second claim listed") },
  { id: "screen-2", say: "Open the third patient", ctx: emr, expect: goes((p) => p.includes("e=enc-T-0606"), "the third patient listed") },
  { id: "screen-3", say: "What am I looking at?", ctx: billing, expect: stays(used("get_screen")) },
  { id: "screen-4", say: "Go back", expect: (r) => (r.actions.some((a) => a.tool === "go_back") ? true : "expected go_back") },
  // Changes: propose, then only a yes confirms
  // L4 is held: SEAL must either propose it with a reason or ask for the biller's reason, never confirm.
  { id: "change-1", say: "Send this claim", ctx: { path: "/billing/claims/clm-L000004", claimId: "clm-L000004" }, expect: (r) => (r.actions.some((a) => a.tool === "confirm_change") ? "confirmed on its own" : r.proposals.some((p) => p.tool === "send_claim") || /reason/i.test(r.reply) ? true : "neither proposed nor asked for the reason") },
  { id: "change-5", say: "Send it, the reason is the doctor confirmed the referral by phone", ctx: { path: "/billing/claims/clm-L000004", claimId: "clm-L000004" }, expect: proposes("send_claim") },
  { id: "change-2", say: "Yes, send it", ctx: pending, expect: (r) => (r.actions.some((a) => a.tool === "confirm_change" && a.args.proposalId === "p1") ? true : "expected confirm_change p1") },
  { id: "change-3", say: "No, don't send it", ctx: pending, expect: (r) => (r.actions.some((a) => a.tool === "confirm_change") ? "confirmed after a no" : true) },
  { id: "change-4", say: "Send all the ready claims", expect: proposes("send_ready_claims") },
  // Data questions: answer, don't move
  { id: "data-1", say: "Which insurer refuses us the most?", expect: stays() },
  { id: "data-2", say: "What does MNEC-003 mean?", expect: stays(used("explain_code")) },
  { id: "data-3", say: "How many claims need attention right now?", expect: stays() },
  { id: "data-4", say: "What's Naved Iqbal's refusal rate?", expect: stays(used("doctor_profile")) },
  { id: "data-5", say: "How much money is at risk today?", expect: stays() },
  // Arabic
  { id: "ar-1", say: "خذني إلى المطالبات المرفوضة", expect: goes(tab("refused"), "Claims · Refused") },
  { id: "ar-2", say: "أين أجد المطالبات المرفوضة؟", expect: offersTo(tab("refused"), "Claims · Refused") },
];

async function main() {
  const d = await tenantDb("seal_apollo");
  const names = await namesHint(d);
  const engine = (process.env.ENGINE as "groq" | "gemini" | undefined) ?? "gemini";
  const only = process.env.ONLY?.split(",");
  const cases = CASES.filter((c) => !only || only.includes(c.id));
  let pass = 0;
  const fails: string[] = [];
  const queue = [...cases];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const ctx: AssistantContext = { path: "/today", ...c.ctx } as AssistantContext;
      const msgs: ChatMsg[] = typeof c.say === "string" ? [{ role: "user", text: c.say }] : c.say;
      const t0 = Date.now();
      try {
        // Free-tier rate limits: wait and try again rather than count it as a failure.
        let r: AgentResult | null = null;
        for (let attempt = 0; !r; attempt++) {
          try {
            r = await runAgent(d, systemInstruction("Apollo Clinic", ctx, false) + names, msgs, ctx, { engine });
          } catch (e) {
            const m = String((e as Error).message);
            if (attempt >= 4 || !/429|rate limit|503|504|DEADLINE|over capacity/i.test(m)) throw e;
            const wait = Math.min(60, Number(/try again in ([\d.]+)s/i.exec(m)?.[1] ?? 20) + 2);
            await new Promise((res) => setTimeout(res, wait * 1000));
          }
        }
        const v = c.expect(r);
        const ms = Date.now() - t0;
        if (v === true) pass++;
        else fails.push(`${c.id}: ${v}\n    said: ${JSON.stringify(msgs.at(-1)!.text)}\n    did: ${[...r.looked, ...r.actions.map((a) => `${a.tool}(${a.args.path ?? JSON.stringify(a.args).slice(0, 80)})`), ...r.proposals.map((p) => `propose ${p.tool}`)].join(" → ") || "nothing"}\n    reply: ${r.reply.slice(0, 160).replace(/\n/g, " ")}`);
        console.log(`${v === true ? "PASS" : "FAIL"} ${c.id.padEnd(11)} ${String(ms).padStart(6)} ms  ${typeof c.say === "string" ? c.say : c.say.at(-1)!.text}`);
      } catch (e) {
        fails.push(`${c.id}: error ${(e as Error).message.slice(0, 200)}`);
        console.log(`ERR  ${c.id}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Number(process.env.CONC ?? 1) }, worker));
  console.log(`\n${pass}/${cases.length} passed (${engine})`);
  if (fails.length) console.log("\n" + fails.join("\n"));
  await (await mongoClient()).close();
}
void main();
