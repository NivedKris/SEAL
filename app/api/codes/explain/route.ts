import { handle } from "@/lib/api/respond";
import { sharedDb } from "@/lib/db/mongo";
import { COLLECTIONS as C } from "@/lib/db/schemas";
import { cptKind, cptLabel, icdLabel } from "@/lib/codes";
import { isKnownDenialCode, denialInfo } from "@/lib/claims/denial-codes";

/** ICD-10-CM chapters by first letter, in plain words. */
const ICD_CHAPTER: Record<string, string> = {
  A: "Infections", B: "Infections", C: "Cancers", D: "Blood, immune or tumours", E: "Hormones, diabetes and nutrition", F: "Mental health", G: "Nerves and brain",
  H: "Eyes and ears", I: "Heart and circulation", J: "Lungs and breathing", K: "Digestion", L: "Skin", M: "Bones, joints and muscles", N: "Kidneys and urinary tract",
  O: "Pregnancy", P: "Newborn", Q: "Born with it", R: "Symptoms, not yet a diagnosis", S: "Injuries", T: "Injuries and poisoning", V: "External cause", W: "External cause",
  X: "External cause", Y: "External cause", Z: "Check-ups and health status",
};
const CPT_KIND: Record<string, string> = { visit: "Doctor visit", lab: "Lab test", imaging: "Scan or X-ray", procedure: "Procedure", therapy: "Therapy", drug: "Medicine" };

export type CodeInfo = {
  code: string;
  system: "CPT" | "ICD-10" | "Denial";
  label: string;
  group?: string;
  /** From SEAL's memory of past claims (last two years). */
  history?: { claims: number; refusedFirst: number; topDenials: { code: string; n: number }[] };
  fix?: string;
};

export async function GET(req: Request) {
  return handle(async () => {
    const codes = [...new Set((new URL(req.url).searchParams.get("codes") ?? "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 40);
    const shared = await sharedDb(); // the regional memory every hospital shares
    const out: CodeInfo[] = [];
    for (const code of codes) {
      if (/^[A-Z]{3,4}-\d{3}$/.test(code)) {
        if (!isKnownDenialCode(code)) out.push({ code, system: "Denial", label: "Insurer refusal code" });
        else {
          const i = denialInfo(code);
          out.push({ code, system: "Denial", label: i.description, group: i.familyName, fix: i.typicalFix });
        }
        continue;
      }
      const isCpt = /^\d{4,5}[A-Z]?$/.test(code);
      const field = isCpt ? "codes" : "diagnoses";
      const [agg] = await shared
        .collection(C.outcomes)
        .aggregate([
          { $match: { [field]: code } },
          { $facet: { n: [{ $count: "n" }], refused: [{ $match: { firstPassRefused: true, ...(isCpt ? { "refusedLines.code": code } : {}) } }, { $count: "n" }], top: [{ $unwind: "$refusedLines" }, ...(isCpt ? [{ $match: { "refusedLines.code": code } }] : []), { $group: { _id: "$refusedLines.denialCode", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 3 }] } },
        ])
        .toArray();
      const history = { claims: agg?.n[0]?.n ?? 0, refusedFirst: agg?.refused[0]?.n ?? 0, topDenials: (agg?.top ?? []).map((t: { _id: string; n: number }) => ({ code: t._id, n: t.n })) };
      if (isCpt) out.push({ code, system: "CPT", label: cptLabel(code), group: CPT_KIND[cptKind(code) ?? ""] ?? "Service", history });
      else out.push({ code, system: "ICD-10", label: icdLabel(code), group: ICD_CHAPTER[code[0]] ?? "Diagnosis", history });
    }
    return { codes: out };
  });
}
