import { z } from "zod";
import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { resetDemo } from "@/lib/admin/reset";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Reset to the seeded state. Body: { confirm: "RESET", clearAiCalls?: boolean } */
export async function POST(req: Request) {
  return handle(async () => {
    const b = z.object({ confirm: z.literal("RESET"), clearAiCalls: z.boolean().optional() }).parse(await req.json());
    return await resetDemo(await db(), { clearAiCalls: b.clearAiCalls });
  });
}
