/**
 * Seeded demo scenarios S1–S8 (plan §11). Hand-written, fictional notes. Each scenario
 * is an open encounter waiting in /emr (or, for S6, a refused claim in the Refused
 * queue), plus whatever history it needs. S7's refusals are generated in the history
 * by the mock insurer's hidden rule (see sim.ts), so SEAL has to learn it.
 */
import type { DocConcept } from "@/lib/rules/dsl";
import { BASE_PRICES, FACILITY, PAYERS, PLANS } from "./world";
import { DAY, dubaiIso } from "./rng";

type Seg = { id: string; part: "complaint" | "findings"; text: string; concepts: DocConcept[] };
type Ord = { code: string; label: string; kind: "lab" | "imaging" | "therapy" | "procedure"; qty?: number };
type Pa = { code: string; approvedQty: number };
export type ScenarioSpec = {
  id: string;
  title: string;
  patient: { first: string; family: string; sex: "M" | "F"; dob: string; nationality: string; payerId: string; plan: "basic" | "plus" };
  providerId: string;
  encounterType: number;
  /** Days before "as of" the encounter happens (0 = today, open in /emr). */
  daysAgo: number;
  segments: Seg[];
  plan: string;
  diagnoses: { code: string; description: string; primary: boolean }[];
  orders: Ord[];
  priorAuths?: Pa[];
  /** Earlier history needed by the scenario: encounters with these lab/imaging codes N days before. */
  history?: { daysAgo: number; codes: string[]; dx: string; theme: string }[];
  expect: string;
};

const s = (id: string, part: Seg["part"], text: string, ...concepts: DocConcept[]): Seg => ({ id, part, text, concepts });

export const SCENARIOS: ScenarioSpec[] = [
  {
    id: "S1",
    title: "Lumbar MRI at a first visit",
    patient: { first: "Arjun", family: "Menon", sex: "M", dob: "1979-03-14", nationality: "IND", payerId: "falcon", plan: "plus" },
    providerId: "dr-omar-haddad",
    encounterType: 1,
    daysAgo: 0,
    segments: [
      s("c0", "complaint", "Patient reports lower back pain going down the left leg.", "signs_or_symptoms_present"),
      s("c1", "complaint", "Pain is worse when sitting at work and when bending.", "signs_or_symptoms_present"),
      s("f0", "findings", "Tenderness over the L4–L5 paraspinal muscles. Lumbar flexion limited by pain."),
      s("f1", "findings", "Gait normal."),
    ],
    plan: "MRI lumbar spine to assess for disc herniation.",
    diagnoses: [{ code: "M54.42", description: "Lumbago with sciatica, left side", primary: true }],
    orders: [{ code: "72148", label: "MRI lumbar spine without contrast", kind: "imaging" }],
    expect: "Two risk cards on the MRI: no symptom duration / prior treatment and no neurologic finding (DAMAN-SPINE-BACKPAIN, MNEC-003), and no prior approval yet (SEAL-PA-MISSING, AUTH-001). Doctor adds the detail; cards turn green.",
  },
  {
    id: "S2",
    title: "Diabetes follow-up",
    patient: { first: "Hind", family: "Al Shamsi", sex: "F", dob: "1968-09-02", nationality: "ARE", payerId: "crescent", plan: "basic" },
    providerId: "dr-yousef-darwish",
    encounterType: 1,
    daysAgo: 0,
    segments: [
      s("c0", "complaint", "Type 2 diabetes follow-up. Reports taking metformin regularly.", "signs_or_symptoms_present"),
      s("c1", "complaint", "No polyuria or polydipsia. Occasional fatigue in the afternoon.", "signs_or_symptoms_present"),
      s("f0", "findings", "BP 132/84. Weight 78 kg, BMI 29.8. Foot examination normal."),
    ],
    plan: "Check HbA1c and C-peptide. Continue metformin.",
    diagnoses: [{ code: "E11.65", description: "Type 2 diabetes mellitus with hyperglycemia", primary: true }],
    orders: [
      { code: "83036", label: "HbA1c (glycated haemoglobin)", kind: "lab" },
      { code: "84681", label: "C-peptide", kind: "lab" },
    ],
    history: [{ daysAgo: 42, codes: ["99214", "83036", "80061"], dx: "E11.65", theme: "diabetes_followup" }],
    expect: "Two risk cards: HbA1c repeated 6 weeks after the last one (DAMAN-DM-HBA1C-FREQ, MNEC-005) and C-peptide not indicated in diabetes care (DAMAN-DM-CPEPTIDE, MNEC-004). Doctor removes C-peptide and records why HbA1c is repeated.",
  },
  {
    id: "S3",
    title: "Routine check-up with vitamin D",
    patient: { first: "Maria", family: "Santos", sex: "F", dob: "1987-05-21", nationality: "PHL", payerId: "gulfshield", plan: "plus" },
    providerId: "dr-mariam-tahir",
    encounterType: 1,
    daysAgo: 0,
    segments: [
      s("c0", "complaint", "Attends for an annual check-up requested by her employer. No complaints.", "signs_or_symptoms_present"),
      s("f0", "findings", "Examination unremarkable. BP 118/76. BMI 23.1."),
      s("f1", "findings", "Past history: hypothyroidism on levothyroxine; previous DEXA showed osteopenia (2025)."),
    ],
    plan: "Routine bloods including vitamin D.",
    diagnoses: [
      { code: "Z00.00", description: "Encounter for general adult medical examination without abnormal findings", primary: true },
      { code: "E03.9", description: "Hypothyroidism, unspecified", primary: false },
    ],
    orders: [
      { code: "85025", label: "Complete blood count with differential", kind: "lab" },
      { code: "82306", label: "Vitamin D, 25-hydroxy", kind: "lab" },
    ],
    expect: "One risk card on vitamin D: no qualifying diagnosis linked (DOH-VITD-INDICATION, MNEC-004). The note mentions osteopenia, so the card offers to link a documented diagnosis, or remove the order.",
  },
  {
    id: "S4",
    title: "Physiotherapy × 6 with approval for 4",
    patient: { first: "Oliver", family: "Whitfield", sex: "M", dob: "1983-11-08", nationality: "GBR", payerId: "falcon", plan: "basic" },
    providerId: "pt-james-oconnor",
    encounterType: 1,
    daysAgo: 0,
    segments: [
      s("c0", "complaint", "Referred after right knee arthroscopic meniscectomy 3 weeks ago for strengthening.", "signs_or_symptoms_present", "symptom_duration"),
      s("f0", "findings", "Quadriceps lag 10°, knee flexion 95°. Pain 5/10 on stairs.", "pain_score_baseline"),
    ],
    plan: "Six sessions of therapeutic exercise and manual therapy.",
    diagnoses: [{ code: "Z47.89", description: "Encounter for other orthopedic aftercare", primary: true }],
    orders: [
      { code: "97110", label: "Therapeutic exercise, each 15 min", kind: "therapy", qty: 6 },
      { code: "97140", label: "Manual therapy, each 15 min", kind: "therapy", qty: 6 },
    ],
    priorAuths: [
      { code: "97110", approvedQty: 4 },
      { code: "97140", approvedQty: 4 },
    ],
    expect: "Held by the rule engine: billed 6 sessions, prior approval covers 4 (SEAL-PA-QUANTITY, AUTH-005). Fix: bill 4 or request an extension.",
  },
  {
    id: "S5a",
    title: "Three claims, three question sets — claim with 3 gaps",
    patient: { first: "Tarek", family: "Mansour", sex: "M", dob: "1974-01-30", nationality: "EGY", payerId: "palm", plan: "plus" },
    providerId: "dr-omar-haddad",
    encounterType: 1,
    daysAgo: 0,
    segments: [
      s("c0", "complaint", "Low back pain radiating to the right buttock, and pain on the outside of the right elbow when gripping.", "signs_or_symptoms_present"),
      s("f0", "findings", "Lumbar paraspinal tenderness. Tender right lateral epicondyle; pain on resisted wrist extension."),
    ],
    plan: "MRI lumbar spine, shockwave therapy to the right elbow, vitamin D level.",
    diagnoses: [
      { code: "M54.41", description: "Lumbago with sciatica, right side", primary: true },
      { code: "M77.11", description: "Lateral epicondylitis, right elbow", primary: false },
    ],
    orders: [
      { code: "72148", label: "MRI lumbar spine without contrast", kind: "imaging" },
      { code: "0102T", label: "Shockwave therapy, lateral humeral epicondyle", kind: "therapy" },
      { code: "82306", label: "Vitamin D, 25-hydroxy", kind: "lab" },
    ],
    priorAuths: [
      { code: "72148", approvedQty: 1 },
      { code: "0102T", approvedQty: 1 },
    ],
    expect: "Exactly 3 questions: MRI (duration + neurologic finding, merged into one question), shockwave (6 months of pain + failed conservative care), vitamin D (qualifying condition).",
  },
  {
    id: "S5b",
    title: "Three claims, three question sets — claim with 1 gap",
    patient: { first: "Priya", family: "Iyer", sex: "F", dob: "1990-07-12", nationality: "IND", payerId: "crescent", plan: "plus" },
    providerId: "dr-omar-haddad",
    encounterType: 1,
    daysAgo: 0,
    segments: [
      s("c0", "complaint", "Low back pain radiating to the left calf for 8 weeks.", "signs_or_symptoms_present", "symptom_duration"),
      s("c1", "complaint", "Six weeks of physiotherapy and naproxen without improvement.", "conservative_treatment_failed"),
      s("f0", "findings", "Straight-leg raise positive at 35° on the left; reduced left ankle reflex; power 4/5 in left plantar flexion.", "neurologic_deficit"),
    ],
    plan: "MRI lumbar spine. Vitamin D level.",
    diagnoses: [{ code: "M54.17", description: "Radiculopathy, lumbosacral region", primary: true }],
    orders: [
      { code: "72148", label: "MRI lumbar spine without contrast", kind: "imaging" },
      { code: "82306", label: "Vitamin D, 25-hydroxy", kind: "lab" },
    ],
    priorAuths: [{ code: "72148", approvedQty: 1 }],
    expect: "Exactly 1 question (vitamin D qualifying condition). The MRI is fully justified.",
  },
  {
    id: "S5c",
    title: "Three claims, three question sets — claim with no gaps",
    patient: { first: "Laith", family: "Haddadin", sex: "M", dob: "1995-02-17", nationality: "JOR", payerId: "falcon", plan: "basic" },
    providerId: "dr-omar-haddad",
    encounterType: 1,
    daysAgo: 0,
    segments: [
      s("c0", "complaint", "Twisted his right knee playing football 2 days ago; swelling since.", "signs_or_symptoms_present", "symptom_duration"),
      s("f0", "findings", "Moderate effusion, medial joint-line tenderness, able to bear weight with pain."),
    ],
    plan: "X-ray right knee.",
    diagnoses: [{ code: "S83.91XA", description: "Sprain of unspecified site of right knee, initial encounter", primary: true }],
    orders: [{ code: "73560", label: "X-ray knee, 1-2 views", kind: "imaging" }],
    expect: "No questions: the claim goes straight to Ready.",
  },
  {
    id: "S8",
    title: "Repeat screening test within 90 days",
    patient: { first: "Sultan", family: "Al Ketbi", sex: "M", dob: "1981-12-05", nationality: "ARE", payerId: "falcon", plan: "plus" },
    providerId: "dr-ahmed-farouk",
    encounterType: 1,
    daysAgo: 0,
    segments: [
      s("c0", "complaint", "Attends for an executive health check. No complaints.", "signs_or_symptoms_present"),
      s("f0", "findings", "Examination normal. BP 124/80."),
    ],
    plan: "Screening bloods.",
    diagnoses: [{ code: "Z00.00", description: "Encounter for general adult medical examination without abnormal findings", primary: true }],
    orders: [
      { code: "80061", label: "Lipid panel", kind: "lab" },
      { code: "85025", label: "Complete blood count with differential", kind: "lab" },
    ],
    history: [{ daysAgo: 55, codes: ["99213", "80061", "85025", "83036"], dx: "Z00.00", theme: "general_checkup" }],
    expect: "Held before sending: same screening tests 55 days after the last ones (DOH-SCREENING-DUP-90D, DUPL-002).",
  },
];

/** S6 is a refused claim already in the Refused queue (built separately). */
export const S6 = {
  id: "S6",
  title: "Abdominal CT refused",
  patient: { first: "Kristine", family: "Bautista", sex: "F" as const, dob: "1992-04-26", nationality: "PHL", payerId: "falcon", plan: "basic" as const },
  providerId: "dr-nadia-haddad",
  daysAgo: 26,
  remitDaysAgo: 4,
  segments: [
    s("c0", "complaint", "Abdominal pain since last night, started around the navel and moved to the right lower abdomen.", "signs_or_symptoms_present", "symptom_duration"),
    s("c1", "complaint", "Nausea and one episode of vomiting. Feels feverish.", "signs_or_symptoms_present"),
    s("f0", "findings", "Temperature 38.4 °C. Tenderness and guarding in the right lower quadrant; positive Rovsing sign.", "signs_or_symptoms_present", "red_flag_symptom"),
    s("f1", "findings", "WBC 14.2 ×10⁹/L with neutrophilia.", "signs_or_symptoms_present"),
  ],
  plan: "CT abdomen and pelvis with contrast to assess for appendicitis.",
  diagnoses: [{ code: "R10.9", description: "Unspecified abdominal pain", primary: true }],
  codes: ["99284", "74177", "85025"],
  denied: { code: "74177", denialCode: "MNEC-003", payerComment: "Diagnosis does not support CT abdomen/pelvis." },
  expect: "Refused MNEC-003 because the claim was coded as unspecified abdominal pain though the note documents right-lower-quadrant pain and fever. Recovery drafts an appeal quoting the note; the coder reviews the code; resubmitted and paid.",
};

export function priceFor(code: string, payerId: string) {
  const f = PAYERS.find((p) => p._id === payerId)!.priceFactor;
  return Math.round((BASE_PRICES[code] ?? 100) * f);
}
export function planFor(payerId: string, plan: "basic" | "plus") {
  return PLANS.find((p) => p._id === `${payerId}-${plan}`)!;
}
export { FACILITY, DAY, dubaiIso };
