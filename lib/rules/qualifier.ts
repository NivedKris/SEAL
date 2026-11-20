import type { Rule } from "./dsl";

/**
 * Rules of the form "needs a qualifying diagnosis on the claim OR a qualifying condition in the
 * note" (e.g. vitamin D): returns the diagnosis patterns. When the note documents the condition but
 * no matching diagnosis is coded, insurers still refuse on the codes — SEAL asks the coder to link
 * the documented diagnosis (the AI never picks the code).
 */
export function codedQualifier(r: Rule): string[] | null {
  if (r.when.op !== "all") return null;
  const parts = r.when.of;
  const dx = parts.find((p) => p.op === "not" && p.of.op === "hasDiagnosis");
  const doc = parts.some((p) => p.op === "not" && p.of.op === "documents" && p.of.concept === "qualifying_diagnosis_documented");
  return dx && doc && dx.op === "not" && dx.of.op === "hasDiagnosis" ? dx.of.codes : null;
}
