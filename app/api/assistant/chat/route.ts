import { z } from "zod";
import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { currentTenant } from "@/lib/tenant-server";
import { ContextSchema, namesHint, systemInstruction } from "@/lib/assistant/tools";
import { runAgent } from "@/lib/assistant/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).min(1).max(40),
  context: ContextSchema,
});

/** Typed questions: the model looks things up with SEAL's tools; changes come back as proposals, moves as screen actions. */
export async function POST(req: Request) {
  return handle(async () => {
    const { messages, context } = Body.parse(await req.json());
    const [d, tenant] = await Promise.all([db(), currentTenant()]);
    return runAgent(d, systemInstruction(tenant.hospital, context, false) + (await namesHint(d)), messages, context);
  });
}
