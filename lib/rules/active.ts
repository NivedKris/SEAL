import "server-only";
import type { Db } from "mongodb";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { Rule } from "./dsl";
import { SEED_RULES } from "./library";

/**
 * SEAL's active rule set, read from MongoDB (so rules approved in /rules take effect) and cached
 * per function instance for 30 s (plan §6: memory is a cache only). Falls back to the seed rules.
 */
let cache: { at: number; rules: Rule[] } | null = null;

export async function activeRules(d: Db): Promise<Rule[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.rules;
  const docs = await d.collection(C.rules).find({ scope: "seal", active: true }).toArray();
  const rules = docs.map((x) => Rule.safeParse(x.dsl)).filter((r) => r.success).map((r) => r.data);
  cache = { at: Date.now(), rules: rules.length ? rules : SEED_RULES };
  return cache.rules;
}

export function invalidateRuleCache() {
  cache = null;
}
