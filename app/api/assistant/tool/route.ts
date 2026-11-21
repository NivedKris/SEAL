import { z } from "zod";
import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { isWriteTool, runReadTool } from "@/lib/assistant/tools";

export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string(), args: z.record(z.string(), z.unknown()).default({}), context: z.object({ path: z.string(), encounterId: z.string().optional(), claimId: z.string().optional(), questionSetId: z.string().optional() }) });

/** Read tools for the live voice session (write tools never run here: they become proposals). */
export async function POST(req: Request) {
  return handle(async () => {
    const { name, args, context } = Body.parse(await req.json());
    if (isWriteTool(name)) return { result: { error: "write tools are proposals on screen, not run on the server" } };
    return { result: await runReadTool(await db(), name, args, context) };
  });
}
