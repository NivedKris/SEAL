import { z } from "zod";
import { handle, actorFrom } from "@/lib/api/respond";
import { submitClaim } from "@/lib/claims/submit";

export const dynamic = "force-dynamic";

/** Send the claim's latest version to the post office. Body (optional): { overrideReason } for a held claim. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = z.object({ overrideReason: z.string().min(3).optional() }).parse(await req.json().catch(() => ({})));
    return { claim: await submitClaim(id, actorFrom(req, "biller"), { overrideReason: body.overrideReason }) };
  });
}
