import { after } from "next/server";
import { handle } from "@/lib/api/respond";
import { pollRemittances } from "@/lib/claims/ingest";
import { readDenials } from "@/lib/recovery/recovery";
import { db } from "@/lib/db/mongo";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Collect new remittances from the post office (which adjudicates anything past its ready time). */
export async function POST() {
  return handle(async () => {
    const received = await pollRemittances();
    // Denial reader on newly refused lines, after the response.
    const refused = received.filter((r) => r.refused > 0);
    if (refused.length) after(async () => {
      const d = await db();
      for (const r of refused) await readDenials(d, r.claimId).catch(() => null);
    });
    return { received };
  });
}
