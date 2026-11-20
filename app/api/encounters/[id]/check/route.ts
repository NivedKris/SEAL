import { z } from "zod";
import { handle } from "@/lib/api/respond";
import { db } from "@/lib/db/mongo";
import { emit } from "@/lib/db/events";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { checkOrders } from "@/lib/check/orders";
import { dubaiIso } from "@/lib/util/time";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * SEAL point-of-care check. mode "rules" (instant), "live" (fast model), "deep" (reasoning model).
 * The EMR panel sends the note as currently typed, so the check never waits for a save.
 * Deep results are recorded as findings and an order.checked event.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const body = z
      .object({ mode: z.enum(["rules", "live", "deep"]), note: z.object({ complaint: z.string().optional(), findings: z.string().optional(), plan: z.string().optional() }).optional() })
      .parse(await req.json());
    const d = await db();
    const r = await checkOrders(id, d, body.mode, body.note ?? {});
    if (body.mode === "deep") {
      const actor = { kind: "agent" as const, id: "order-check" };
      await d.collection(C.findings).updateMany({ encounterId: id, claimId: { $exists: false }, status: "open" }, { $set: { status: "dismissed" } });
      const docs = r.orders.flatMap((o) =>
        o.cards.map((c, i) => ({
          _id: `${id}-poc-${Date.now()}-${o.orderId}-${i}`,
          encounterId: id,
          orderId: o.orderId,
          stage: "point_of_care_deep",
          ruleId: c.ruleId,
          pastClaimIds: [],
          denialCode: c.denialCode,
          evidenceSpan: c.evidence[0],
          insurerNeeds: c.insurerNeeds,
          severity: c.severity,
          status: "open",
          kind: c.kind === "link_diagnosis" ? "fix" : c.kind,
          gapConcepts: c.missing.map((m) => m.concept),
          aiCallId: r.aiCallId,
          writtenBy: actor,
          writtenAt: dubaiIso(),
        })),
      );
      if (docs.length) await d.collection(C.findings).insertMany(docs as never[]);
      await emit("order.checked", { encounterId: id, mode: "deep", orders: r.orders.length, atRisk: r.orders.filter((o) => o.status === "at_risk").length, ms: r.ms }, actor);
    }
    return r;
  });
}
