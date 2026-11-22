import { handle, actorFrom } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { applyRecoveryFix, recoveryPlan, RecoveryFixInput } from "@/lib/recovery/plan";

export const dynamic = "force-dynamic";

/** Win it back: the refused lines, SEAL's fix for each, and the working resubmission. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => recoveryPlan(await db(), id));
}

/** Apply one fix to the working resubmission (a person clicked it or said yes). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => applyRecoveryFix(await db(), id, RecoveryFixInput.parse(await req.json()), actorFrom(req, "biller")));
}
