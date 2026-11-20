import { z } from "zod";
import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { addDiagnosis } from "@/lib/emr/store";

export const dynamic = "force-dynamic";

/** The doctor adds a diagnosis (source "doctor"); SEAL never does. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const { icd10, primary } = z.object({ icd10: z.string().min(3), primary: z.boolean().optional() }).parse(await req.json());
    await addDiagnosis(await db(), id, icd10, primary);
    return { ok: true };
  });
}
