import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import cptFile from "@/research/R5/codes/cpt_seal_subset.json";

/** Display labels for codes (R5). CPT labels are SEAL-written; ICD-10-CM descriptions are CMS FY2027. */
const CPT_LIST = cptFile.codes as { code: string; label: string; kind: string }[];
const CPT = new Map<string, string>(CPT_LIST.map((c) => [c.code, c.label]));
let ICD: Map<string, string> | null = null;

function icd(): Map<string, string> {
  if (!ICD) {
    const raw = gunzipSync(readFileSync(join(process.cwd(), "research/R5/codes/icd10cm_2027_full.json.gz"))).toString();
    ICD = new Map((JSON.parse(raw) as { codes: { code: string; description: string }[] }).codes.map((c) => [c.code, c.description]));
  }
  return ICD;
}

export const cptLabel = (code: string) => CPT.get(code) ?? code;
export const icdLabel = (code: string) => icd().get(code) ?? code;
export const cptKind = (code: string) => CPT_LIST.find((c) => c.code === code)?.kind ?? null;

/** Order search over SEAL's CPT subset (orders only: no visit codes). */
export function searchCpt(q: string, limit = 12) {
  const t = q.toLowerCase().trim();
  return CPT_LIST.filter((c) => c.kind !== "visit" && (!t || c.code.startsWith(t) || c.label.toLowerCase().includes(t))).slice(0, limit);
}

/** Diagnosis search over ICD-10-CM; optional patterns ("M85.8*", "E55*") narrow it to qualifying codes. */
export function searchIcd(q: string, patterns: string[] = [], limit = 15) {
  const t = q.toLowerCase().trim();
  const match = (code: string) => !patterns.length || patterns.some((p) => (p.endsWith("*") ? code.startsWith(p.slice(0, -1)) : code === p));
  const out: { code: string; description: string }[] = [];
  for (const [code, description] of icd()) {
    if (!match(code)) continue;
    if (t && !code.toLowerCase().startsWith(t) && !description.toLowerCase().includes(t)) continue;
    out.push({ code, description });
    if (out.length >= limit) break;
  }
  return out;
}
