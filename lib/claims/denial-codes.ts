import codes from "@/research/R2/denial_codes.json";

/** The R2 denial-code list (plan acceptance: every denial code shown exists in this list). */
export type DenialCodeInfo = { code: string; family: string; familyName: string; description: string; status: "VERIFIED" | "UNVERIFIED"; typicalFix?: string };

const BY_CODE = new Map<string, DenialCodeInfo>((codes.codes as DenialCodeInfo[]).map((c) => [c.code, c]));

export function denialInfo(code: string): DenialCodeInfo {
  const c = BY_CODE.get(code);
  if (!c) throw new Error(`denial code ${code} is not in research/R2/denial_codes.json`);
  return c;
}
export const isKnownDenialCode = (code: string) => BY_CODE.has(code);
export const denialFamily = (code: string) => denialInfo(code).family;
