import { after } from "next/server";
import { handle, actorFrom } from "@/lib/api/respond";
import { signEncounter } from "@/lib/claims/builder";
import { runClaimCheck, warmEmbeddings } from "@/lib/check/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** EMR Sign: marks the encounter signed, builds its claim, and starts the real-time check at once (plan §5). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  void warmEmbeddings();
  return handle(async () => {
    const claim = await signEncounter(id, actorFrom(req, "doctor"));
    after(() => runClaimCheck(claim._id).catch(() => null));
    return { claim };
  });
}
