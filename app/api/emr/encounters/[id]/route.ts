import { z } from "zod";
import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { saveNote } from "@/lib/emr/store";
import { encounterView } from "@/lib/views/pages";

export const dynamic = "force-dynamic";

/** EMR simulator: one encounter with patient banner data, orders (incl. removed) and diagnoses. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => encounterView(await db(), id));
}

/** Save the note (complaint as told, findings, plan). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = z.object({ complaint: z.string().max(5000).optional(), findings: z.string().max(5000).optional(), plan: z.string().max(3000).optional() }).parse(await req.json());
    await saveNote(await db(), id, body);
    return { ok: true };
  });
}
