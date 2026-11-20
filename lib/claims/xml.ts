import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { ClaimSubmission, RemittanceAdvice } from "./schema";

/** Elements that can repeat, so they always parse as arrays. */
const ARRAYS = new Set(["Claim", "Diagnosis", "Activity", "Observation", "DxInfo"]);
/** Elements whose text is numeric in the eClaimLink types. */
const NUMBERS = new Set(["RecordCount", "Type", "StartType", "EndType", "Gross", "PatientShare", "Net", "Quantity", "List", "PaymentAmount"]);
/** "Type" is numeric only under Encounter and Activity; Diagnosis/Observation/Resubmission types are text. */
const TEXT_TYPE_PARENTS = new Set(["Diagnosis", "Observation", "Resubmission", "DxInfo"]);

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ARRAYS.has(name),
  // Strip namespace prefixes so files with tns:/ns1: prefixes parse the same.
  transformTagName: (name) => name.replace(/^[\w-]+:/, ""),
});

function coerce(node: unknown, parent = ""): unknown {
  if (Array.isArray(node)) return node.map((n) => coerce(n, parent));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && NUMBERS.has(k) && !(k === "Type" && TEXT_TYPE_PARENTS.has(parent))) {
        out[k] = v === "" ? undefined : Number(v);
      } else out[k] = coerce(v, k);
    }
    return out;
  }
  return node;
}

export type ParsedTransaction =
  | { kind: "Claim.Submission"; data: ReturnType<typeof ClaimSubmission.parse> }
  | { kind: "Remittance.Advice"; data: ReturnType<typeof RemittanceAdvice.parse> };

/** Parse an eClaimLink XML file and validate it against the R1 field rules. Throws ZodError on failure. */
export function parseTransaction(xml: string): ParsedTransaction {
  const doc = parser.parse(xml) as Record<string, unknown>;
  if (doc["Claim.Submission"]) return { kind: "Claim.Submission", data: ClaimSubmission.parse(coerce(doc["Claim.Submission"])) };
  if (doc["Remittance.Advice"]) return { kind: "Remittance.Advice", data: RemittanceAdvice.parse(coerce(doc["Remittance.Advice"])) };
  throw new Error(`Unknown root element: ${Object.keys(doc).filter((k) => k !== "?xml").join(", ")}`);
}

const builder = new XMLBuilder({ format: true, indentBy: "  ", suppressEmptyNode: true });

/** Money and quantities as eClaimLink files write them (2 decimals for amounts). */
function formatNumbers(node: unknown, key = ""): unknown {
  if (Array.isArray(node)) return node.map((n) => formatNumbers(n, key));
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).filter(([, v]) => v !== undefined).map(([k, v]) => [k, formatNumbers(v, k)]));
  if (typeof node === "number" && ["Gross", "PatientShare", "Net", "List", "PaymentAmount"].includes(key)) return node.toFixed(2);
  return node;
}

/** Build XML from a validated transaction. Validates first, so an invalid claim never leaves SEAL. */
export function buildClaimSubmission(tx: ClaimSubmission): string {
  const data = ClaimSubmission.parse(tx);
  return `<?xml version="1.0" encoding="utf-8"?>\n` + builder.build({ "Claim.Submission": formatNumbers(data) });
}

export function buildRemittanceAdvice(tx: RemittanceAdvice): string {
  const data = RemittanceAdvice.parse(tx);
  return `<?xml version="1.0" encoding="utf-8"?>\n` + builder.build({ "Remittance.Advice": formatNumbers(data) });
}
