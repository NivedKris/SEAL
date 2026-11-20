import { after } from "next/server";
import { handle, actorFrom } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C, type ClaimDoc } from "@/lib/db/schemas";
import { applyFix, FixInput, recommendFixes } from "@/lib/claims/fix";
import { runClaimCheck } from "@/lib/check/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Recommended corrections for the claim's open problems. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const d = await db();
    const claim = (await d.collection(C.claims).findOne({ _id: id as never })) as ClaimDoc | null;
    if (!claim) throw new Error(`claim ${id} not found`);
    return { fixes: await recommendFixes(d, claim) };
  });
}

/** Apply one correction, then re-check the claim. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const d = await db();
    const claim = await applyFix(d, id, FixInput.parse(await req.json()), actorFrom(req, "biller"));
    after(() => runClaimCheck(id, { database: d, force: true }).catch(() => null));
    return { claim };
  });
}
