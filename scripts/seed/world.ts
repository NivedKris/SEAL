/**
 * The fictional world the seed builds (plan §4, §11). Every value here without a
 * research source is an ASSUMPTION and is listed in `ASSUMPTIONS` (shown on /admin
 * and in research/data-report.md).
 */

export const SEED_VERSION = "seed-2026.11.19-v1";
/** History window: 12 months ending the day before the build date. */
export const HISTORY_START = "2025-11-17";
export const HISTORY_END = "2026-11-16";

export const FACILITY = {
  id: "DHA-F-SEAL001",
  name: "Seabreeze Specialty Hospital",
  nameAr: "مستشفى سيبريز التخصصي",
  city: "Dubai",
  beds: 180,
};

export const PAYERS = [
  { _id: "falcon", name: "Falcon Health", nameAr: "فالكون للتأمين الصحي", eclaimLinkId: "INS-FALCON", share: 0.32, priceFactor: 1.0 },
  { _id: "crescent", name: "Crescent Care", nameAr: "كريسنت كير", eclaimLinkId: "INS-CRESCENT", share: 0.27, priceFactor: 0.95 },
  { _id: "gulfshield", name: "Gulf Shield", nameAr: "درع الخليج", eclaimLinkId: "INS-GULFSHLD", share: 0.23, priceFactor: 0.9 },
  { _id: "palm", name: "Palm Assurance", nameAr: "بالم أشورنس", eclaimLinkId: "INS-PALM", share: 0.18, priceFactor: 1.05 },
] as const;
export type PayerId = (typeof PAYERS)[number]["_id"];

/** Prior approval needed for MRI/CT, therapy treatment sessions (not evaluations) and ESWT on every plan — ASSUMPTION. */
const PA_CODES = ["72141-72158", "72125-72133", "73218-73223", "73718-73723", "74176-74178", "97110-97150", "97530-97546", "0101T", "0102T", "28890"];

export const PLANS = PAYERS.flatMap((p) => [
  { _id: `${p._id}-basic`, payerId: p._id, name: `${p.name} Essential`, benefits: [] as string[], priorAuthRequired: PA_CODES, copayPct: 0.2, share: 0.55 },
  { _id: `${p._id}-plus`, payerId: p._id, name: `${p.name} Plus`, benefits: ["health_screening"], priorAuthRequired: PA_CODES, copayPct: 0.1, share: 0.45 },
]);

/** Base price list in AED — ASSUMPTION (DoH Mandatory Tariff workbook is behind a login). */
export const BASE_PRICES: Record<string, number> = {
  "99202": 300, "99203": 350, "99204": 450, "99205": 550, "99211": 150, "99212": 200, "99213": 250, "99214": 320, "99215": 400, "99283": 380, "99284": 460,
  "83036": 90, "83037": 60, "82947": 25, "82950": 30, "82951": 80, "84681": 180, "83525": 120, "84206": 200, "86337": 220, "86341": 250,
  "80061": 120, "83721": 60, "84478": 40, "82465": 30, "83718": 40, "82043": 70, "82570": 30, "82565": 30, "84443": 90, "82607": 110,
  "82306": 180, "82652": 260, "80053": 150, "80048": 90, "80076": 110, "85025": 60, "82728": 90, "83540": 50, "86140": 70, "85651": 30,
  "81001": 40, "86803": 130, "87340": 110, "36415": 20,
  "72100": 220, "72141": 1500, "72142": 1700, "72146": 1500, "72147": 1700, "72148": 1500, "72149": 1700, "72156": 2400, "72157": 2400, "72158": 2400,
  "72131": 900, "72132": 1100, "73221": 1500, "73721": 1500, "73560": 150, "74176": 1200, "74177": 1700, "74178": 2000, "76705": 350,
  "97161": 250, "97162": 300, "97110": 150, "97112": 150, "97140": 150, "97530": 150, "97150": 100, "97165": 250, "97168": 200,
  "0101T": 800, "0102T": 800, "28890": 800,
  "20610": 400, "20611": 600, "96372": 60, "93000": 120, "93224": 600, "44970": 9000,
};

export type Specialty = "orthopaedics" | "radiology" | "internal_medicine" | "family_medicine" | "emergency_medicine" | "endocrinology" | "physiotherapy" | "cardiology";

/** Fictional clinicians. Dr. Omar Haddad is the plan's orthopaedic consultant. */
export const PROVIDERS: { _id: string; name: string; nameAr: string; specialty: Specialty; role: "consultant" | "specialist" | "general_practitioner" | "therapist" }[] = [
  { _id: "dr-omar-haddad", name: "Dr. Omar Haddad", nameAr: "د. عمر حداد", specialty: "orthopaedics", role: "consultant" },
  { _id: "dr-lina-saeed", name: "Dr. Lina Saeed", nameAr: "د. لينا سعيد", specialty: "orthopaedics", role: "specialist" },
  { _id: "dr-karim-nassar", name: "Dr. Karim Nassar", nameAr: "د. كريم نصار", specialty: "orthopaedics", role: "specialist" },
  { _id: "dr-hessa-alameri", name: "Dr. Hessa Al Ameri", nameAr: "د. حصة العامري", specialty: "internal_medicine", role: "consultant" },
  { _id: "dr-rohan-mehta", name: "Dr. Rohan Mehta", nameAr: "د. روهان ميهتا", specialty: "internal_medicine", role: "specialist" },
  { _id: "dr-sara-kurian", name: "Dr. Sara Kurian", nameAr: "د. سارة كوريان", specialty: "internal_medicine", role: "specialist" },
  { _id: "dr-yousef-darwish", name: "Dr. Yousef Darwish", nameAr: "د. يوسف درويش", specialty: "endocrinology", role: "consultant" },
  { _id: "dr-mariam-tahir", name: "Dr. Mariam Tahir", nameAr: "د. مريم طاهر", specialty: "family_medicine", role: "general_practitioner" },
  { _id: "dr-ahmed-farouk", name: "Dr. Ahmed Farouk", nameAr: "د. أحمد فاروق", specialty: "family_medicine", role: "general_practitioner" },
  { _id: "dr-nadia-haddad", name: "Dr. Nadia Rizk", nameAr: "د. نادية رزق", specialty: "emergency_medicine", role: "specialist" },
  { _id: "dr-tomas-reyes", name: "Dr. Tomas Reyes", nameAr: "د. توماس رييس", specialty: "emergency_medicine", role: "specialist" },
  { _id: "dr-aisha-kamali", name: "Dr. Aisha Kamali", nameAr: "د. عائشة كمالي", specialty: "cardiology", role: "consultant" },
  { _id: "pt-james-oconnor", name: "James O'Connor, PT", nameAr: "جيمس أوكونور", specialty: "physiotherapy", role: "therapist" },
  { _id: "pt-fatima-zahra", name: "Fatima Zahra, PT", nameAr: "فاطمة الزهراء", specialty: "physiotherapy", role: "therapist" },
];

/**
 * Clinical themes. Each maps MTSamples sources to an encounter shape. `weight` sets
 * the encounter mix (ASSUMPTION, tuned to an orthopaedics-led specialty hospital).
 */
export const THEMES = {
  low_back_pain: { weight: 0.12, specialties: ["orthopaedics"], encounterType: 1, mts: { spec: ["Orthopedic", "Pain Management", "Physical Medicine - Rehab", "Consult - History and Phy."], kw: ["low back pain", "lumbar", "sciatica", "radiculopathy"] } },
  neck_pain: { weight: 0.05, specialties: ["orthopaedics"], encounterType: 1, mts: { spec: ["Orthopedic", "Pain Management", "Consult - History and Phy."], kw: ["neck pain", "cervical", "cervicalgia"] } },
  knee_pain: { weight: 0.08, specialties: ["orthopaedics"], encounterType: 1, mts: { spec: ["Orthopedic", "Consult - History and Phy."], kw: ["knee pain", "knee", "meniscus", "osteoarthritis"] } },
  shoulder_pain: { weight: 0.06, specialties: ["orthopaedics"], encounterType: 1, mts: { spec: ["Orthopedic", "Consult - History and Phy."], kw: ["shoulder pain", "rotator cuff", "impingement"] } },
  tendinopathy: { weight: 0.03, specialties: ["orthopaedics"], encounterType: 1, mts: { spec: ["Orthopedic", "Podiatry", "Consult - History and Phy."], kw: ["plantar fasciitis", "heel pain", "epicondylitis", "tennis elbow"] } },
  diabetes_followup: { weight: 0.16, specialties: ["internal_medicine", "endocrinology"], encounterType: 1, mts: { spec: ["Endocrinology", "General Medicine", "SOAP / Chart / Progress Notes", "Office Notes", "Consult - History and Phy."], kw: ["diabetes", "diabetic", "hemoglobin a1c", "metformin"] } },
  hypertension_lipids: { weight: 0.08, specialties: ["internal_medicine", "family_medicine"], encounterType: 1, mts: { spec: ["General Medicine", "SOAP / Chart / Progress Notes", "Office Notes", "Cardiovascular / Pulmonary"], kw: ["hypertension", "hyperlipidemia", "cholesterol"] } },
  general_checkup: { weight: 0.1, specialties: ["family_medicine", "internal_medicine"], encounterType: 1, mts: { spec: ["General Medicine", "SOAP / Chart / Progress Notes", "Office Notes"], kw: ["physical exam", "annual", "check", "routine", "well"] } },
  fatigue_anaemia: { weight: 0.07, specialties: ["internal_medicine", "family_medicine"], encounterType: 1, mts: { spec: ["General Medicine", "Hematology - Oncology", "Consult - History and Phy.", "SOAP / Chart / Progress Notes"], kw: ["fatigue", "anemia", "tired", "weakness"] } },
  thyroid: { weight: 0.03, specialties: ["endocrinology", "internal_medicine"], encounterType: 1, mts: { spec: ["Endocrinology", "General Medicine", "Consult - History and Phy."], kw: ["thyroid", "hypothyroidism", "hyperthyroidism"] } },
  osteoporosis: { weight: 0.03, specialties: ["internal_medicine", "endocrinology"], encounterType: 1, mts: { spec: ["Rheumatology", "General Medicine", "Endocrinology", "Consult - History and Phy."], kw: ["osteoporosis", "osteopenia", "bone density"] } },
  abdominal_pain_er: { weight: 0.07, specialties: ["emergency_medicine"], encounterType: 2, mts: { spec: ["Emergency Room Reports", "Gastroenterology", "Consult - History and Phy."], kw: ["abdominal pain", "appendicitis", "right lower quadrant"] } },
  injury_er: { weight: 0.05, specialties: ["emergency_medicine"], encounterType: 2, mts: { spec: ["Emergency Room Reports", "Orthopedic"], kw: ["fall", "injury", "fracture", "sprain"] } },
  palpitations: { weight: 0.03, specialties: ["cardiology", "internal_medicine"], encounterType: 1, mts: { spec: ["Cardiovascular / Pulmonary", "Consult - History and Phy.", "General Medicine"], kw: ["palpitations", "arrhythmia", "atrial fibrillation"] } },
  physio_course: { weight: 0.04, specialties: ["physiotherapy"], encounterType: 1, mts: { spec: ["Physical Medicine - Rehab", "Orthopedic"], kw: ["physical therapy", "rehabilitation", "therapy"] } },
} as const;
export type Theme = keyof typeof THEMES;

export const ASSUMPTIONS: { key: string; value: string; why: string }[] = [
  { key: "base prices", value: "SEAL price list in AED (scripts/seed/world.ts BASE_PRICES)", why: "DoH Mandatory Tariff workbook requires a Shafafiya login; no public Dubai tariff found" },
  { key: "contract price factors", value: "Falcon 1.00, Crescent 0.95, Gulf Shield 0.90, Palm 1.05", why: "Fictional insurers; no source" },
  { key: "prior-approval codes", value: PA_CODES.join(", "), why: "No public Daman list; common practice for imaging and therapy" },
  { key: "payer mix", value: PAYERS.map((p) => `${p.name} ${Math.round(p.share * 100)}%`).join(", "), why: "Fictional" },
  { key: "theme mix", value: "orthopaedics-led specialty hospital mix (THEMES weights)", why: "Fictional hospital profile" },
  { key: "first-pass refusal target", value: "12%–18% of claims per insurer", why: "Inside the published 15–25% Saudi range; UAE totals not published (plan §11)" },
  { key: "noise denials", value: "≈2–3% of claims get an administrative denial unrelated to documentation", why: "Mock insurer noise so SEAL predicts rather than reads the answer key (plan §11)" },
  { key: "lab–diagnosis fit table", value: "scripts/seed/sim.ts LAB_DX_FIT (mock insurer hidden rule HIDDEN-LAB-DX-FIT)", why: "Common clinical indications; no published UAE table. Models AccuMed's disputed test claims" },
  { key: "test bloat", value: "share of encounters with 1–3 extra routine labs (calibrated)", why: "AccuMed: 2–12 tests ordered for the same diagnosis" },
  { key: "DoH rules in Dubai", value: "R4 Abu Dhabi rules applied to Dubai insurers", why: "No Dubai equivalent found" },
];
