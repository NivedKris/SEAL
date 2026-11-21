import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { handle } from "@/lib/api/respond";
import { assistantGeminiKey } from "@/lib/assistant/keys";
import { currentTenant } from "@/lib/tenant-server";
import { ALL_TOOLS, LIVE_TOOLS, systemInstruction } from "@/lib/assistant/tools";
import { LIVE_MODELS, LIVE_VOICE } from "@/lib/assistant/models";

export const dynamic = "force-dynamic";

const Body = z.object({ context: z.object({ path: z.string(), encounterId: z.string().optional(), claimId: z.string().optional(), questionSetId: z.string().optional() }), mode: z.enum(["talk", "scribe"]).default("talk") });

/**
 * A single-use token for one live voice session (the API key never reaches the browser), plus the
 * session setup: model, voice, SEAL's instructions for this screen, and the tools.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { context, mode } = Body.parse(await req.json().catch(() => ({})));
    const tenant = await currentTenant();
    const ai = new GoogleGenAI({ apiKey: assistantGeminiKey(), httpOptions: { apiVersion: "v1alpha" } });
    const token = await ai.authTokens.create({
      config: { uses: 1, expireTime: new Date(Date.now() + 30 * 60_000).toISOString(), newSessionExpireTime: new Date(Date.now() + 2 * 60_000).toISOString(), httpOptions: { apiVersion: "v1alpha" } },
    });
    const scribe =
      mode === "scribe"
        ? [
            "\nSCRIBE MODE: you are listening to a consultation between a doctor and a patient. Your replies are shown as short text, not spoken.",
            "As facts are said, call update_note (the patient's own words → complaint, examination → findings, plan → plan) and propose diagnoses and orders. Keep each update short and only what was said.",
            "When a test, scan or procedure is planned, call get_context and insurer_rules for it. If the insurer will need something that has not been said yet, reply with ONE line starting 'Ask:' followed by the question the doctor should ask now, e.g. 'Ask: how long has the pain lasted, and what treatment was tried first?'. Otherwise stay silent.",
            "Reply only when the doctor addresses you as SEAL, or with an 'Ask:' nudge.",
          ].join(" ")
        : "";
    return {
      token: token.name,
      models: LIVE_MODELS,
      voice: LIVE_VOICE,
      systemInstruction: systemInstruction(tenant.hospital, context, true) + scribe,
      tools: [...ALL_TOOLS, ...LIVE_TOOLS],
    };
  });
}
