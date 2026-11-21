/** Insurer names as remittance exports write them → as people say them. */
const KNOWN: Record<string, string> = {
  "QAT INS": "Qatar Insurance",
  "ORIENT INS": "Orient Insurance",
  NLGI: "NLGI",
  CIGNA: "Cigna",
  "SUKOON INS": "Sukoon Insurance",
  "TAKAFUL EMARAT - INS": "Takaful Emarat",
  "DXB INS": "Dubai Insurance",
  ADNIC: "ADNIC",
  METLIFE: "MetLife",
  NGI: "NGI",
  GIG: "GIG",
  DAMAN: "Daman",
};
export function insurerName(raw: string): string {
  const k = raw.replace(/\s+/g, " ").trim();
  return KNOWN[k.toUpperCase()] ?? k.replace(/\s*-?\s*\bINS\b\.?$/i, " Insurance").replace(/\s+/g, " ").trim();
}
