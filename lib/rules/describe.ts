import type { Predicate } from "./dsl";

/** A rule condition in plain English, for reviewers in /rules. */
export function describe(p: Predicate): string {
  switch (p.op) {
    case "all":
      return p.of.map(describe).join(" and ");
    case "any":
      return `(${p.of.map(describe).join(" or ")})`;
    case "not":
      return p.of.op === "hasDiagnosis" ? `no diagnosis ${p.of.codes.join(", ")}` : p.of.op === "documents" ? `the note does not document ${p.of.concept.replace(/_/g, " ")}` : `not ${describe(p.of)}`;
    case "hasDiagnosis":
      return `diagnosis ${p.codes.join(", ")}${p.principalOnly ? " (principal)" : ""}`;
    case "claimHasActivity":
      return `${p.codes.join(", ")} also billed`;
    case "priorActivityWithin":
      return `${p.codes.join(", ")} done in the previous ${p.days} days${p.samePayer ? " (same insurer)" : ""}`;
    case "countWithin":
      return `more than ${p.max} × ${p.codes.join(", ")} in ${p.days} days`;
    case "quantityExceeds":
      return p.max === "priorAuthApproved" ? "quantity above the approved quantity" : `quantity above ${p.max}`;
    case "priorAuthMissing":
      return "no prior approval";
    case "clinicianSpecialtyIn":
      return `ordered by ${p.values.join(", ").replace(/_/g, " ")}`;
    case "encounterTypeIn":
      return `encounter type ${p.values.join(", ")}`;
    case "patientAge":
      return p.gte !== undefined && p.lte !== undefined ? `age ${p.gte}–${p.lte}` : p.gte !== undefined ? `age ${p.gte}+` : `age ≤ ${p.lte}`;
    case "benefitMissing":
      return `plan lacks ${p.benefit.replace(/_/g, " ")}`;
    case "documents":
      return `the note documents ${p.concept.replace(/_/g, " ")}`;
    case "labPerformedInHouse":
      return "lab done in house";
  }
}
