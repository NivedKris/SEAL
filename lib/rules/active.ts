import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { Rule } from "./dsl";
import { SEED_RULES } from "./library";

/**
 * SEAL's active rule set, read from MongoDB (so rules approved in /rules take effect) and cached
 * per function instance for 30 s (plan §6: memory is a cache only). Falls back to the seed rules.
 */
// One cache per hospital database, so a rule approved at one hospital never leaks to another.
const caches = new Map<string, { at: number; rules: Rule[] }>();

export async function activeRules(d: Db): Promise<Rule[]> {
  const cache = caches.get(d.databaseName);
  if (cache && Date.now() - cache.at < 30_000) return cache.rules;
  const docs = await d.collection(C.rules).find({ scope: "seal", active: true }).toArray();
  const rules = docs.map((x) => Rule.safeParse(x.dsl)).filter((r) => r.success).map((r) => r.data);
  const next = { at: Date.now(), rules: rules.length ? rules : SEED_RULES };
  caches.set(d.databaseName, next);
  return next.rules;
}

export function invalidateRuleCache() {
  caches.clear();
}
