import { eventsSince } from "@/lib/db/events";
import { db } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";

export const dynamic = "force-dynamic";

/**
 * Domain events after a cursor, for views that watch other people's actions (polled every 1.5 s).
 * ?since=<seq> (omit or 0 to get only the current cursor), ?types=a,b to filter.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since") ?? 0) || 0;
  const types = url.searchParams.get("types")?.split(",").filter(Boolean);
  if (!since) {
    const last = await (await db()).collection(C.events).find({}, { projection: { seq: 1 } }).sort({ seq: -1 }).limit(1).toArray();
    return Response.json({ cursor: last[0]?.seq ?? 0, events: [] });
  }
  const all = await eventsSince(since);
  return Response.json({ cursor: all.at(-1)?.seq ?? since, events: all.filter((e) => !types || types.includes(e.type)) });
}
