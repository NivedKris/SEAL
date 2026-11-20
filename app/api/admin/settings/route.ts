import { z } from "zod";
import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { AGENTS, GROQ, GEMINI, EMBEDDING } from "@/config/models";
import { SEED_META } from "@/lib/admin/reset";

export const dynamic = "force-dynamic";

/** Admin state: settings, judges, model config, collection counts vs the seed, assumptions. */
export async function GET() {
  return handle(async () => {
    const d = await db();
    const [settings, judges] = await Promise.all([d.collection(C.settings).findOne({ _id: "settings" as never }), d.collection(C.judges).findOne({ _id: "judges" as never })]);
    const counts = Object.fromEntries(await Promise.all(Object.values(C).map(async (c) => [c, await d.collection(c).estimatedDocumentCount()] as const)));
    return { settings, judges, agents: AGENTS, models: { groq: GROQ, gemini: GEMINI, embedding: EMBEDDING }, counts, seed: SEED_META };
  });
}

const Patch = z.object({
  insurerDelaySeconds: z.number().int().min(0).max(3600).optional(),
  killSwitches: z.record(z.string(), z.boolean()).optional(),
  modelOverrides: z.record(z.string(), z.string()).optional(),
  activeJudge: z.enum(["agentic_llm", "trained_model"]).optional(),
  shadowJudge: z.enum(["agentic_llm", "trained_model"]).nullable().optional(),
});

export async function PATCH(req: Request) {
  return handle(async () => {
    const b = Patch.parse(await req.json());
    const d = await db();
    const set: Record<string, unknown> = {};
    if (b.insurerDelaySeconds !== undefined) set.insurerDelaySeconds = b.insurerDelaySeconds;
    if (b.killSwitches) set.killSwitches = b.killSwitches;
    if (b.modelOverrides) set.modelOverrides = Object.fromEntries(Object.entries(b.modelOverrides).filter(([, v]) => v));
    if (Object.keys(set).length) await d.collection(C.settings).updateOne({ _id: "settings" as never }, { $set: set }, { upsert: true });
    const j: Record<string, unknown> = {};
    if (b.activeJudge) j.active = b.activeJudge;
    if (b.shadowJudge !== undefined) j.shadow = b.shadowJudge;
    if (Object.keys(j).length) await d.collection(C.judges).updateOne({ _id: "judges" as never }, { $set: j }, { upsert: true });
    return { ok: true };
  });
}
