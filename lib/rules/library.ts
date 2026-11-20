import { RuleFile, type Rule } from "./dsl";
import dmLabs from "@/research/R3/rules/daman-diabetes-labs.json";
import spine from "@/research/R3/rules/daman-spine-imaging.json";
import therapy from "@/research/R3/rules/daman-therapy-cardiac.json";
import vitdPa from "@/research/R3/rules/vitamin-d-and-prior-auth.json";
import doh from "@/research/R4/rules/doh-adjudication.json";

/**
 * SEAL's seeded rule set (research R3 + R4). In the running app the rules live in
 * MongoDB (`rules` collection) so they can be versioned and approved; this is the
 * source the seed loads from.
 */
export const RULE_FILES = [dmLabs, spine, therapy, vitdPa, doh].map((f) => RuleFile.parse(f));
export const SEED_RULES: Rule[] = RULE_FILES.flatMap((f) => f.rules);
export const RULE_SET_VERSION = "seal-rules-2026.11.19";
