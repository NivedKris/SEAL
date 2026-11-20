import { z } from "zod";
import { handle, actorFrom } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { decideProposal } from "@/lib/learning/cycle";

export const dynamic = "force-dynamic";

/** Approve or reject a proposed rule. Body: { decision: "approved"|"rejected", reason? } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const b = z.object({ decision: z.enum(["approved", "rejected"]), reason: z.string().optional() }).parse(await req.json());
    return await decideProposal(await db(), id, b.decision, actorFrom(req, "coding-specialist").id, b.reason);
  });
}
