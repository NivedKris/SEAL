import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C, type ClaimDoc } from "@/lib/db/schemas";
import { claimVersionXml } from "@/lib/claims/submit";

export const dynamic = "force-dynamic";

/** The eClaimLink XML for a claim version (?version=n, default latest). Rebuilt on demand for seeded history. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const version = Number(new URL(req.url).searchParams.get("version")) || undefined;
  const d = await db();
  const claim = (await d.collection(C.claims).findOne({ _id: id as never })) as ClaimDoc | null;
  if (!claim) return Response.json({ error: `claim ${id} not found` }, { status: 404 });
  try {
    return new Response(await claimVersionXml(claim, version, d), { headers: { "content-type": "application/xml; charset=utf-8" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
