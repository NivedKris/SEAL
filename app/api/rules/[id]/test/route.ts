import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { Rule } from "@/lib/rules/dsl";
import { testRule } from "@/lib/learning/cycle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Test this rule" against history: rule in the library, or a proposal's rule (?proposal=1). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const d = await db();
    const fromProposal = new URL(req.url).searchParams.get("proposal");
    const doc = fromProposal ? await d.collection(C.ruleProposals).findOne({ _id: id as never }) : await d.collection(C.rules).findOne({ _id: id as never });
    if (!doc) throw new Error(`rule ${id} not found`);
    return { result: await testRule(d, Rule.parse(doc.dsl)) };
  });
}
