/**
 * Seed simulation core (plan §11 steps 3–5): encounters from templates, documentation
 * gaps injected one rule at a time with ground truth, claims, and adjudication by the
 * mock insurer's hidden rules plus noise, then resubmission/recovery.
 *
 * Pure and deterministic for a given (plan, params). No I/O.
 */
import type { DocConcept, Rule } from "@/lib/rules/dsl";
import { LAB_CODES, LAB_DX_FIT } from "@/lib/mock/tables";
import { anyMatch, checkLine, evaluate, ruleApplies, type HistoryItem, type RuleContext } from "@/lib/rules/engine";
import { BASE_PRICES, FACILITY, PAYERS, PLANS, PROVIDERS, THEMES, type Theme } from "./world";
import { DAY, Rng, dateMs } from "./rng";
import type { Template } from "./build-templates";

// ── Types ─────────────────────────────────────────────────────────────────
export type Params = {
  /** Multiplies every documentation-gap probability. */
  gapScale: number;
  /** Multiplies administrative/noise denial probabilities. */
  noiseScale: number;
  /** Probability a prior approval is missing where one is required. */
  paMissing: number;
  /** Multiplies documentation-gap probabilities for imaging and therapy rules (labs use gapScale). */
  imagingGapScale: number;
  /** Probability an encounter gets 1–3 extra routine labs ("test bloat", AccuMed). */
  bloat: number;
  /** Probability the coder omits a supporting symptom code for a clinically ordered lab. */
  coderMiss: number;
  /** Per-insurer enforcement multiplier (calibrated toward the 12–18% band). */
  strictness?: Record<string, number>;
};

export type SimPatient = {
  id: string;
  sex: "M" | "F";
  dob: string;
  nationality: string;
  first: string;
  family: string;
  memberId: string;
  payerId: string;
  planId: string;
  validFrom: number;
  validTo: number;
  conditions: Set<string>;
};

export type SimSegment = { id: string; part: "complaint" | "findings"; text: string; concepts: DocConcept[] };
export type SimLine = {
  activityId: string;
  code: string;
  kind: "lab" | "imaging" | "procedure" | "therapy" | "visit";
  quantity: number;
  price: number;
  net: number;
  priorAuth?: { authNo: string; approvedQty: number };
};
export type Gap = { ruleId: string; code: string; concepts: DocConcept[] };
export type LineResult = { activityId: string; code: string; net: number; paid: number; denialCode?: string; source?: string };
export type Remit = { version: number; at: number; lines: LineResult[]; idPayer: string; paymentRef: string };

export type SimEncounter = {
  id: string;
  claimId: string;
  claimNo: string;
  patient: SimPatient;
  providerId: string;
  specialty: string;
  theme: Theme;
  templateId: string;
  encounterType: number;
  at: number;
  segments: SimSegment[];
  plan: string;
  diagnoses: { code: string; primary: boolean }[];
  lines: SimLine[];
  gaps: Gap[];
  /** Structural risks injected (PA missing, quantity, specialty, unbundling…). */
  injected: string[];
  submittedAt: number;
  remits: Remit[];
  resubmissions: { version: number; at: number; type: "correction" | "internal complaint"; comment: string; fixes: string[] }[];
  evalSet: boolean;
  scenario?: string;
};

export type Plan = {
  patients: SimPatient[];
  visits: { patientIdx: number; theme: Theme; at: number; scenario?: string }[];
};

// ── Constants ─────────────────────────────────────────────────────────────
const HISTORY_START = dateMs("2025-11-17");
const HISTORY_END = dateMs("2026-11-16");
const KIND: Record<string, SimLine["kind"]> = {};
for (const c of LAB_CODES) KIND[c] = "lab";
for (const c of ["72100", "72141", "72142", "72146", "72147", "72148", "72149", "72156", "72157", "72158", "72131", "72132", "73221", "73721", "73560", "74176", "74177", "74178", "76705"]) KIND[c] = "imaging";
for (const c of ["97161", "97162", "97110", "97112", "97140", "97530", "97150", "97165", "97168", "0101T", "0102T", "28890"]) KIND[c] = "therapy";
for (const c of ["20610", "20611", "96372", "93000", "93224", "36415", "44970"]) KIND[c] = "procedure";
const isPhysioTheme = (t: Theme) => t === "physio_course";
export const kindOf = (code: string): SimLine["kind"] => (code.startsWith("992") ? "visit" : KIND[code] ?? "procedure");

/** Base documentation-gap probability per rule (scaled by params.gapScale). */
const GAP_BASE: Record<string, number> = {
  "DAMAN-SPINE-BACKPAIN": 0.32,
  "DAMAN-SPINE-SCREENING": 0.02,
  "DAMAN-SPINE-REPEAT-180": 0.4,
  "DAMAN-ESWT-CONSERVATIVE": 0.3,
  "DAMAN-OT-REEVAL": 0.3,
  "DAMAN-DM-HBA1C-FREQ": 0.6,
  "DAMAN-DM-CPEPTIDE": 0.92,
  "DAMAN-DM-LIPID-FREQ": 0.5,
  "DAMAN-DM-TSH-T2": 0.45,
  "DAMAN-DM-B12-METFORMIN": 0.5,
  "DAMAN-DM-ASYMPTOMATIC": 0.15,
  "DOH-VITD-INDICATION": 0.55,
};

/** Generic note text that establishes a concept, used to complete a note before gaps are injected. */
const SUPPLEMENTS: Record<DocConcept, string[]> = {
  symptom_duration: ["Symptoms have been present for {n} weeks.", "Ongoing for about {n} weeks, gradually worse."],
  conservative_treatment_failed: ["Tried paracetamol and NSAIDs with rest for {n} weeks without improvement.", "Completed {n} weeks of home exercises and analgesia; no relief."],
  neurologic_deficit: ["Reduced ankle reflex and decreased sensation in the L5 dermatome on the affected side; straight-leg raise positive at 40°.", "Power 4/5 in ankle dorsiflexion with diminished sensation over the dorsum of the foot."],
  new_or_progressive_deficit: ["Weakness has progressed since the previous scan; new foot drop noted."],
  red_flag_symptom: ["Reports new urinary retention and saddle numbness since yesterday."],
  signs_or_symptoms_present: ["Patient reports symptoms prompting evaluation today."],
  qualifying_diagnosis_documented: ["Known osteopenia on DEXA {n} months ago; on calcium supplementation."],
  reason_for_repeat_test: ["HbA1c repeated before 3 months because metformin dose was increased {n} weeks ago; reassessing control."],
  medication_change: ["Atorvastatin started {n} weeks ago; lipid profile to assess response."],
  neuro_manifestations: ["Reports tingling and numbness in both feet for several months."],
  pain_score_baseline: ["Pain score 7/10 at rest."],
  pain_score_improvement: ["Pain improved from 7/10 to 4/10 since the first session."],
  significant_change_in_condition: ["Unexpected decline in function since the last assessment."],
  previous_investigation_inconclusive: ["Previous 24-hour recording was inconclusive."],
};

export { LAB_DX_FIT };
/** Symptom/status code a coder adds so a routine lab is supported (ASSUMPTION). */
export const LAB_SUPPORT_DX: Record<string, string> = {
  "85025": "R53.83", "80053": "R53.83", "80048": "R53.83", "84443": "R53.83", "80061": "Z13.220", "82607": "R20.2",
  "85651": "M25.50", "86140": "M25.50", "82728": "R53.83", "83540": "R53.83", "81001": "R30.0", "82565": "Z79.899",
};
const BLOAT_POOL = ["85025", "80053", "84443", "82607", "82728", "83540", "80061", "81001", "86140", "85651"];

const DIABETES_POOL: [string, number][] = [
  ["80061", 0.55], ["82043", 0.45], ["82565", 0.45], ["80053", 0.3], ["85025", 0.35], ["84443", 0.25], ["82607", 0.18], ["82306", 0.2],
  ["81001", 0.2], ["80048", 0.15], ["82947", 0.3], ["80076", 0.12], ["82570", 0.4], ["84681", 0.045], ["83525", 0.02],
];

// ── Plan: patients and visit schedule (independent of params) ─────────────
export function buildPlan(total: number, seed: number, names: typeof import("./names").NATIONALITIES): Plan {
  const rng = new Rng(seed);
  const patients: SimPatient[] = [];
  const newPatient = (ageMin = 18, ageMax = 80, sex?: "M" | "F"): number => {
    const nat = rng.weighted(names, (n) => n.share);
    const s = sex ?? (rng.chance(0.56) ? "M" : "F");
    const age = rng.int(ageMin, ageMax);
    const dob = new Date(Date.UTC(2026 - age, rng.int(0, 11), rng.int(1, 28))).toISOString().slice(0, 10);
    const payer = rng.weighted(PAYERS, (p) => p.share);
    const plan = rng.weighted(PLANS.filter((p) => p.payerId === payer._id), (p) => p.share);
    const id = `pat-${String(patients.length + 1).padStart(5, "0")}`;
    // ~0.6% of members' cover ends inside the window (drives ELIG-005).
    const validTo = rng.chance(0.006) ? HISTORY_START + rng.int(120, 330) * DAY : dateMs("2027-06-30");
    patients.push({
      id,
      sex: s,
      dob,
      nationality: nat.code,
      first: rng.pick(s === "M" ? nat.male : nat.female),
      family: rng.pick(nat.family),
      memberId: `mem-${id.slice(4)}`,
      payerId: payer._id,
      planId: plan._id,
      validFrom: dateMs("2025-01-01"),
      validTo,
      conditions: new Set(),
    });
    return patients.length - 1;
  };

  const visits: Plan["visits"] = [];
  const counts = Object.fromEntries(Object.entries(THEMES).map(([t, v]) => [t, Math.round(v.weight * total)])) as Record<Theme, number>;
  const randomDay = () => HISTORY_START + rng.int(0, Math.floor((HISTORY_END - HISTORY_START) / DAY)) * DAY + rng.int(8, 19) * 3600_000;

  // Chronic cohorts: repeated visits per patient so frequency rules have real history.
  const chronic: Partial<Record<Theme, { mean: number; early: number }>> = {
    diabetes_followup: { mean: 100, early: 0.22 },
    hypertension_lipids: { mean: 150, early: 0.12 },
    thyroid: { mean: 150, early: 0.1 },
    osteoporosis: { mean: 180, early: 0.1 },
  };
  for (const [theme, n] of Object.entries(counts) as [Theme, number][]) {
    const c = chronic[theme];
    if (!c) continue;
    let made = 0;
    while (made < n) {
      const p = newPatient(35, 78);
      patients[p].conditions.add(theme);
      let at = HISTORY_START + rng.int(0, 120) * DAY + rng.int(8, 18) * 3600_000;
      while (at < HISTORY_END && made < n) {
        visits.push({ patientIdx: p, theme, at });
        made++;
        const gap = rng.chance(c.early) ? rng.int(30, 75) : rng.int(Math.round(c.mean * 0.8), Math.round(c.mean * 1.3));
        at += gap * DAY;
      }
    }
  }
  // Episodic themes: mostly new patients, some returning ones.
  for (const [theme, n] of Object.entries(counts) as [Theme, number][]) {
    if (chronic[theme]) continue;
    for (let i = 0; i < n; i++) {
      const reuse = patients.length > 50 && rng.chance(0.25);
      const p = reuse ? rng.int(0, patients.length - 1) : newPatient(theme === "general_checkup" ? 20 : 18, 75);
      visits.push({ patientIdx: p, theme, at: randomDay() });
    }
  }

  // Repeat check-ups 30–85 days apart (employer + personal screening) drive DUPL-002 on labs.
  const checkups = visits.filter((v) => v.theme === "general_checkup" && v.at < HISTORY_END - 90 * DAY);
  for (const v of checkups) if (rng.chance(0.1)) visits.push({ patientIdx: v.patientIdx, theme: "general_checkup", at: v.at + rng.int(30, 85) * DAY });

  // S7 support: Gulf Shield patients without diabetes, lipid 6–10 months ago and again in the last 30 days.
  for (let i = 0; i < 12; i++) {
    const p = newPatient(40, 70);
    patients[p].payerId = "gulfshield";
    patients[p].planId = "gulfshield-basic";
    visits.push({ patientIdx: p, theme: "hypertension_lipids", at: HISTORY_END - rng.int(190, 300) * DAY + 10 * 3600_000, scenario: "S7" });
    visits.push({ patientIdx: p, theme: "hypertension_lipids", at: HISTORY_END - rng.int(2, 28) * DAY + 11 * 3600_000, scenario: "S7" });
  }

  visits.sort((a, b) => a.at - b.at);
  return { patients, visits };
}

// ── Simulation ────────────────────────────────────────────────────────────
type HiddenRule = { id: string; denialCode: string; p: number; applies: (e: SimEncounter, l: SimLine, age: number) => boolean };

const HIDDEN: HiddenRule[] = [
  {
    // IMO Health example (plan S6): CT abdomen coded with unspecified abdominal pain only.
    id: "HIDDEN-CT-ABD-UNSPECIFIED",
    denialCode: "MNEC-003",
    p: 0.7,
    applies: (e, l) => anyMatch(["74176-74178"], l.code) && e.diagnoses.every((d) => anyMatch(["R10.9", "R10.84"], d.code)),
  },
  {
    // S7: Gulf Shield starts refusing lipid panels repeated within 12 months for patients without diabetes.
    id: "HIDDEN-GS-LIPID-12M",
    denialCode: "MNEC-005",
    p: 0.95,
    applies: () => false, // evaluated with history below
  },
  {
    // Palm is stricter than the DoH policy on vitamin D for patients over 65.
    id: "HIDDEN-PALM-VITD-65",
    denialCode: "MNEC-004",
    p: 0.8,
    applies: (e, l, age) =>
      e.patient.payerId === "palm" && l.code === "82306" && age >= 65 && !e.diagnoses.some((d) => anyMatch(["E55*", "M80*", "M81*", "M85.8*", "N18*", "K90*"], d.code)),
  },
  {
    // Routine lab without a diagnosis on the claim that plausibly fits it (AccuMed pattern).
    id: "HIDDEN-LAB-DX-FIT",
    denialCode: "MNEC-004",
    p: 0.5,
    applies: (e, l) => l.code in LAB_DX_FIT && !e.diagnoses.some((d) => anyMatch(LAB_DX_FIT[l.code], d.code)),
  },
  {
    id: "HIDDEN-CRESCENT-ESR-CRP",
    denialCode: "MNEC-006",
    p: 0.2,
    applies: (e, l) => e.patient.payerId === "crescent" && l.code === "85651" && e.lines.some((x) => x.code === "86140"),
  },
];
const GS_LIPID_START = dateMs("2026-09-20");

const ENFORCE: Record<string, number> = { MNEC: 0.88, DUPL: 0.9, AUTH: 0.96, CODE: 0.9, PRCE: 0.8, NCOV: 0.95 };
export const PAYER_STRICTNESS: Record<string, number> = { falcon: 1, crescent: 0.95, gulfshield: 0.97, palm: 1.03 };
const ADMIN_NOISE: [string, number][] = [["CLAI-012", 0.22], ["COPY-001", 0.18], ["PRCE-001", 0.2], ["PRCE-007", 0.12], ["CODE-001", 0.1], ["TIME-001", 0.06], ["ELIG-001", 0.03]];

export type SimResult = { encounters: SimEncounter[]; patients: SimPatient[] };

export function simulate(plan: Plan, templates: Template[], rules: Rule[], params: Params, seed: number, limit?: number): SimResult {
  const rng = new Rng(seed);
  const byTheme = new Map<Theme, Template[]>();
  for (const t of templates) byTheme.set(t.theme, [...(byTheme.get(t.theme) ?? []), t]);
  const history = new Map<string, HistoryItem[]>();
  const seenAtHospital = new Set<string>();
  const encounters: SimEncounter[] = [];
  const planById = new Map(PLANS.map((p) => [p._id, p]));
  const payerById = new Map<string, (typeof PAYERS)[number]>(PAYERS.map((p) => [p._id, p]));
  let authSeq = 1;

  // Subsample by patient (not by visit) so each patient's history stays complete.
  const keepEvery = limit ? Math.max(1, Math.round(plan.visits.length / limit)) : 1;
  const visits = keepEvery > 1 ? plan.visits.filter((v) => v.patientIdx % keepEvery === 0 || v.scenario) : plan.visits;

  for (const [vi, v] of visits.entries()) {
    const patient = plan.patients[v.patientIdx];
    const tpls = byTheme.get(v.theme);
    if (!tpls?.length) continue;
    const age = Math.floor((v.at - Date.parse(patient.dob)) / (365.25 * DAY));
    const tpl = rng.pick(tpls.filter((t) => t.sex === "any" || t.sex === patient.sex).length ? tpls.filter((t) => t.sex === "any" || t.sex === patient.sex) : tpls);
    const themeCfg = THEMES[v.theme];

    // Provider: theme specialty; a GP occasionally orders spine imaging (CODE-010 risk).
    let provider = rng.pick(PROVIDERS.filter((p) => (themeCfg.specialties as readonly string[]).includes(p.specialty)));
    const injected: string[] = [];
    if ((v.theme === "low_back_pain" || v.theme === "neck_pain") && rng.chance(0.025)) {
      provider = rng.pick(PROVIDERS.filter((p) => p.specialty === "family_medicine"));
      injected.push("gp_orders_spine_imaging");
    }
    if (v.scenario === "S7") provider = PROVIDERS.find((p) => p._id === "dr-rohan-mehta")!;

    // Segments (complete note first).
    let segments: SimSegment[] = [
      ...tpl.complaintSegments.map((s, i) => ({ id: `c${i}`, part: "complaint" as const, text: s.text, concepts: [...s.concepts] })),
      ...tpl.findingSegments.map((s, i) => ({ id: `f${i}`, part: "findings" as const, text: s.text, concepts: [...s.concepts] })),
    ];
    let diagnoses = tpl.diagnoses.map((d) => ({ code: d.icd10, primary: d.primary }));

    // Orders.
    const codes: string[] = [];
    if (v.theme === "diabetes_followup") {
      const k = rng.skewed(2, 12, 0.42); // 2–12 tests, skewed low (AccuMed)
      codes.push("83036");
      const pool = [...DIABETES_POOL];
      while (codes.length < k && pool.length) {
        const pick = rng.weighted(pool, ([, w]) => w);
        pool.splice(pool.indexOf(pick), 1);
        codes.push(pick[0]);
      }
      if (!diagnoses.some((d) => anyMatch(["E10*", "E11*", "E13*"], d.code))) diagnoses = [{ code: "E11.9", primary: true }, ...diagnoses.map((d) => ({ ...d, primary: false }))];
    } else {
      for (const o of tpl.orders) if (!codes.includes(o.code)) codes.push(o.code);
      if (v.theme === "general_checkup" && !codes.includes("82306") && rng.chance(0.35)) codes.push("82306");
      if (v.theme === "fatigue_anaemia" && !codes.includes("82306") && rng.chance(0.4)) codes.push("82306");
      // Templates sometimes carry billing conflicts; a careful clinic avoids them. Clean, then inject at a controlled rate.
      if (codes.includes("93224") && codes.includes("93000")) codes.splice(codes.indexOf("93000"), 1);
      for (const [w, c, combined] of [["72148", "72149", "72158"], ["72141", "72142", "72156"], ["72146", "72147", "72157"]]) {
        if (codes.includes(w) && codes.includes(c)) {
          codes.splice(codes.indexOf(c), 1);
          codes[codes.indexOf(w)] = combined;
        }
      }
      if (v.theme === "palpitations" && codes.includes("93224") && rng.chance(0.08)) {
        codes.push("93000");
        injected.push("ecg_with_holter");
      }
      if (v.theme === "hypertension_lipids" && !codes.includes("80061")) codes.push("80061");
    }
    // A routine check-up is coded Z00.0x principal; known conditions become secondary (non-medical codes dropped).
    if (v.theme === "general_checkup") {
      const secondary = diagnoses.filter((d) => /^[EIFMDN]/.test(d.code)).map((d) => ({ ...d, primary: false }));
      diagnoses = [{ code: rng.chance(0.8) ? "Z00.00" : "Z00.01", primary: true }, ...secondary.slice(0, 3)];
    }
    if (v.theme === "tendinopathy" && !diagnoses.some((d) => anyMatch(["M77.1*", "M72.2*", "M77.3*", "M75.3*", "M70.6*"], d.code)) && rng.chance(0.85)) {
      diagnoses = [{ code: rng.pick(["M77.11", "M77.12", "M72.21", "M72.22", "M77.31"]), primary: true }, ...diagnoses.map((d) => ({ ...d, primary: false }))];
    }
    if (v.theme === "abdominal_pain_er" && rng.chance(0.12)) {
      diagnoses = [{ code: "R10.9", primary: true }];
      injected.push("unspecified_abdominal_pain_coded");
    }
    // Test bloat: extra routine labs the diagnosis may not support.
    if (!isPhysioTheme(v.theme) && rng.chance(params.bloat)) {
      const k = Math.min(rng.skewed(1, 3, 0.55), v.theme === "diabetes_followup" ? Math.max(0, 12 - codes.length) : 3);
      for (const c of rng.shuffle([...BLOAT_POOL]).filter((c) => !codes.includes(c)).slice(0, k)) codes.push(c);
      injected.push(`test_bloat:${k}`);
    }
    // Coding diligence: a lab whose diagnosis doesn't fit usually gets a supporting symptom code
    // from the coder (1 − coderMiss for clinically ordered labs, 25% for bloat).
    const bloatSet = new Set(injected.some((x) => x.startsWith("test_bloat")) ? codes.slice(-3) : []);
    for (const c of codes) {
      if (!(c in LAB_DX_FIT) || diagnoses.some((d) => anyMatch(LAB_DX_FIT[c], d.code))) continue;
      if (rng.chance(bloatSet.has(c) ? 0.25 : 1 - params.coderMiss) && !diagnoses.some((d) => d.code === LAB_SUPPORT_DX[c])) diagnoses.push({ code: LAB_SUPPORT_DX[c], primary: false });
    }
    // Unbundled contrast MRI (PRCE-010 risk).
    if (codes.includes("72148") && rng.chance(0.015)) {
      codes.push("72149");
      injected.push("mri_contrast_unbundled");
    }
    // In-house venipuncture billed (DoH rule, PRCE-002 risk).
    if (codes.some((c) => kindOf(c) === "lab") && rng.chance(0.006 * params.noiseScale)) {
      codes.push("36415");
      injected.push("venipuncture_inhouse");
    }

    // Visit line.
    const isEr = themeCfg.encounterType === 2;
    const isPhysio = v.theme === "physio_course";
    const newHere = !seenAtHospital.has(patient.id);
    seenAtHospital.add(patient.id);
    const visitCode = isEr ? rng.pick(["99283", "99284"]) : isPhysio ? null : newHere ? rng.pick(["99203", "99204"]) : rng.pick(["99213", "99214"]);
    const allCodes = [...(visitCode ? [visitCode] : []), ...codes];

    const payer = payerById.get(patient.payerId)!;
    const planDoc = planById.get(patient.planId)!;
    const paRequired = (code: string) => !isEr && anyMatch(planDoc.priorAuthRequired, code);
    const sessions = isPhysio ? rng.pick([4, 6, 6, 8]) : 1;
    const lines: SimLine[] = allCodes.map((code, i) => {
      const qty = kindOf(code) === "therapy" && isPhysio && code !== "97161" && code !== "97162" ? sessions : 1;
      const price = Math.round((BASE_PRICES[code] ?? 100) * payer.priceFactor);
      const net = Math.round(price * qty * (1 - (isEr ? 0 : planDoc.copayPct)) * 100) / 100;
      const line: SimLine = { activityId: String(i + 1), code, kind: kindOf(code), quantity: qty, price, net };
      if (paRequired(code)) {
        if (rng.chance(params.paMissing)) injected.push(`pa_missing:${code}`);
        else {
          let approved = qty;
          if (isPhysio && qty > 1 && rng.chance(0.04)) {
            approved = qty - 2;
            injected.push(`pa_qty_exceeded:${code}`);
          }
          line.priorAuth = { authNo: `PA-${payer._id.slice(0, 2).toUpperCase()}-${String(authSeq++).padStart(6, "0")}`, approvedQty: approved };
        }
      }
      return line;
    });

    // Rule context with documentation read from the current segments.
    const hist = history.get(patient.id) ?? [];
    const present = () => new Set(segments.flatMap((s) => s.concepts));
    const ctxFor = (docs: (c: DocConcept) => boolean | null): RuleContext => ({
      payerId: patient.payerId,
      encounterType: themeCfg.encounterType,
      clinicianSpecialty: provider.specialty,
      patientAge: age,
      diagnoses,
      lines,
      history: hist,
      at: v.at,
      benefits: planDoc.benefits,
      priorAuthRequired: paRequired,
      priorAuthFor: (code) => lines.find((l) => l.code === code)?.priorAuth ?? null,
      labInHouse: true,
      documents: docs,
    });

    // Complete the note for every doc-dependent rule, then inject gaps one rule at a time.
    // Documentation quality is correlated within an encounter (habits, time pressure):
    // ~25% of encounters are "thin" and carry most gaps.
    const thin = rng.chance(0.25);
    const docFactor = thin ? 3 : 0.3;
    const gaps: Gap[] = [];
    for (const line of lines) {
      for (const rule of rules) {
        if (!ruleApplies(rule, patient.payerId, line.code)) continue;
        const ifAllDocs = evaluate(rule.when, ctxFor(() => true), line);
        const ifNoDocs = evaluate(rule.when, ctxFor(() => false), line);
        if (ifAllDocs !== false || ifNoDocs !== true) continue; // not documentation-dependent here
        const needed = conceptList(rule);
        // Complete: add supplements until the rule no longer fires.
        for (const c of needed) {
          const cur = present();
          if (evaluate(rule.when, ctxFor((x) => cur.has(x)), line) === false) break;
          if (cur.has(c)) continue;
          const text = rng.pick(SUPPLEMENTS[c]).replace("{n}", String(rng.int(3, 10)));
          segments.push({ id: `s${segments.length}`, part: c === "neurologic_deficit" || c === "new_or_progressive_deficit" ? "findings" : "complaint", text, concepts: [c] });
          if (c === "qualifying_diagnosis_documented" && line.code.startsWith("823") && !diagnoses.some((d) => d.code.startsWith("M85.8"))) diagnoses.push({ code: "M85.80", primary: false });
        }
        // Inject a gap with the rule's probability.
        const scale = rule.target.kind === "lab" ? params.gapScale : params.imagingGapScale;
        const p = Math.min(0.97, (GAP_BASE[rule.id] ?? 0.25) * scale * docFactor);
        if (!rng.chance(p)) continue;
        const removable = rng.shuffle([...needed]);
        const removed: DocConcept[] = [];
        for (const c of removable) {
          const keepComplaint = segments.filter((s) => s.part === "complaint" && !s.concepts.includes(c)).length >= 1;
          const keepFindings = segments.filter((s) => s.part === "findings" && !s.concepts.includes(c)).length >= 1;
          if (!keepComplaint || !keepFindings) continue;
          segments = segments.filter((s) => !s.concepts.includes(c));
          removed.push(c);
          const cur = present();
          if (evaluate(rule.when, ctxFor((x) => cur.has(x)), line) === true) break;
        }
        const cur = present();
        if (removed.length && evaluate(rule.when, ctxFor((x) => cur.has(x)), line) === true) gaps.push({ ruleId: rule.id, code: line.code, concepts: removed });
      }
    }

    const id = `enc-${String(vi + 1).padStart(6, "0")}`;
    const enc: SimEncounter = {
      id,
      claimId: `clm-${id.slice(4)}`,
      claimNo: `SSH-${new Date(v.at).getUTCFullYear()}-${String(vi + 1).padStart(6, "0")}`,
      patient,
      providerId: provider._id,
      specialty: provider.specialty,
      theme: v.theme,
      templateId: tpl.id,
      encounterType: themeCfg.encounterType,
      at: v.at,
      segments,
      plan: tpl.plan,
      diagnoses,
      lines,
      gaps,
      injected,
      submittedAt: v.at + rng.int(1, 4) * DAY + rng.int(1, 8) * 3600_000,
      remits: [],
      resubmissions: [],
      evalSet: false,
      scenario: v.scenario,
    };
    if (rng.chance(0.0008 * params.noiseScale)) {
      enc.submittedAt = v.at + rng.int(95, 140) * DAY; // late filing
      injected.push("late_submission");
    }

    adjudicate(enc, rules, ctxFor((x) => present().has(x)), age, params, rng, hist);
    recover(enc, rng);
    encounters.push(enc);

    // History: every performed activity, for later frequency/duplicate rules.
    hist.push(...lines.map((l) => ({ code: l.code, at: v.at, payerId: patient.payerId, specialty: provider.specialty })));
    history.set(patient.id, hist);
  }
  return { encounters, patients: plan.patients };
}

function conceptList(rule: Rule): DocConcept[] {
  const out: DocConcept[] = [];
  const walk = (p: Rule["when"]) => {
    if (p.op === "documents" && !out.includes(p.concept)) out.push(p.concept);
    if (p.op === "all" || p.op === "any") p.of.forEach(walk);
    if (p.op === "not") walk(p.of);
  };
  walk(rule.when);
  return out;
}

// ── Mock insurer (hidden rules + SEAL's public rules with enforcement + noise) ──
function adjudicate(e: SimEncounter, rules: Rule[], ctx: RuleContext, age: number, params: Params, rng: Rng, hist: HistoryItem[]) {
  const strict = params.strictness?.[e.patient.payerId] ?? PAYER_STRICTNESS[e.patient.payerId] ?? 1;
  const results: LineResult[] = e.lines.map((l) => ({ activityId: l.activityId, code: l.code, net: l.net, paid: l.net }));
  const deny = (r: LineResult, code: string, source: string) => {
    if (r.denialCode) return;
    r.denialCode = code;
    r.paid = code === "PRCE-001" ? Math.round(r.net * 0.8 * 100) / 100 : 0;
    r.source = source;
  };

  // Eligibility (real rule): service after cover ended → whole claim.
  if (e.at > e.patient.validTo) results.forEach((r) => deny(r, "ELIG-005", "eligibility"));
  if (e.submittedAt - e.at > 90 * DAY) results.forEach((r) => deny(r, "TIME-001", "filing_deadline"));

  for (const [i, line] of e.lines.entries()) {
    const r = results[i];
    for (const hit of checkLine(rules, ctx, line, "claim")) {
      if (hit.fired !== true) continue;
      const fam = hit.rule.family;
      if (rng.chance(Math.min(0.99, (ENFORCE[fam] ?? 0.85) * (PAYER_STRICTNESS[e.patient.payerId] ?? 1)))) deny(r, hit.rule.denialCode, hit.ruleId);
    }
    for (const h of HIDDEN) {
      if (h.id === "HIDDEN-GS-LIPID-12M") {
        const fires =
          e.patient.payerId === "gulfshield" &&
          e.at >= GS_LIPID_START &&
          anyMatch(["80061", "83721"], line.code) &&
          !e.diagnoses.some((d) => anyMatch(["E10*", "E11*", "E13*"], d.code)) &&
          hist.some((x) => anyMatch(["80061", "83721"], x.code) && e.at - x.at <= 365 * DAY);
        if (fires && rng.chance(Math.min(0.99, h.p * strict))) deny(r, h.denialCode, h.id);
      } else if (h.applies(e, line, age) && rng.chance(Math.min(0.99, h.p * strict))) deny(r, h.denialCode, h.id);
    }
    // Clinical noise: the insurer refuses a clean lab line (appealable).
    if (line.kind === "lab" && !r.denialCode && rng.chance(0.006 * params.noiseScale * strict)) deny(r, rng.pick(["MNEC-003", "MNEC-004"]), "noise_clinical");
  }
  // Administrative noise: one line, or the whole claim for ELIG-001.
  if (rng.chance(0.022 * params.noiseScale)) {
    const [code] = rng.weighted(ADMIN_NOISE, ([, w]) => w);
    if (code === "ELIG-001") results.forEach((r) => deny(r, code, "noise_admin"));
    else deny(rng.pick(results), code, "noise_admin");
  }
  const at = e.submittedAt + rng.int(18, 44) * DAY;
  e.remits.push({ version: 1, at, lines: results, idPayer: `${e.patient.payerId.slice(0, 2).toUpperCase()}-CLM-${e.claimId.slice(4)}`, paymentRef: `${e.patient.payerId.toUpperCase()}-EFT-${new Date(at).toISOString().slice(0, 10).replace(/-/g, "")}` });
}

/** Resubmission behaviour before SEAL (the seeded baseline). Up to 2 resubmissions (Dubai directive). */
function recover(e: SimEncounter, rng: Rng) {
  const first = e.remits[0];
  const denied = first.lines.filter((l) => l.denialCode);
  if (!denied.length) return;
  // Claims refused in the last ~35 days are still waiting in the Refused queue.
  if (first.at > HISTORY_END - 35 * DAY) return;
  const fixable = (l: LineResult) => {
    const gap = e.gaps.find((g) => g.code === l.code && l.source === g.ruleId);
    if (gap) return { resub: 0.6, win: 0.55, fix: `addendum: ${gap.concepts.join(", ")}` };
    if (l.source === "noise_clinical") return { resub: 0.7, win: 0.85, fix: "appeal with note evidence" };
    if (l.denialCode === "AUTH-001") return { resub: 0.45, win: 0.35, fix: "retro prior approval" };
    if (l.denialCode === "AUTH-005") return { resub: 0.5, win: 0.4, fix: "approval extension" };
    if (l.denialCode?.startsWith("NCOV") || l.denialCode?.startsWith("ELIG")) return { resub: 0.2, win: 0.15, fix: "appeal" };
    if (l.denialCode === "PRCE-010") return { resub: 0.8, win: 0.9, fix: "rebilled with combined code" };
    return { resub: 0.4, win: 0.45, fix: "correction" };
  };
  const plans = denied.map((l) => ({ l, f: fixable(l) })).filter(({ f }) => rng.chance(f.resub));
  if (!plans.length) return;
  const at = first.at + rng.int(5, 25) * DAY;
  e.resubmissions.push({
    version: 2,
    at,
    type: plans.some(({ l }) => l.source === "noise_clinical" || l.denialCode?.startsWith("MNEC")) ? "internal complaint" : "correction",
    comment: plans.map(({ f }) => f.fix).join("; "),
    fixes: plans.map(({ f }) => f.fix),
  });
  const lines: LineResult[] = plans.map(({ l, f }) => (rng.chance(f.win) ? { ...l, paid: l.net, denialCode: undefined } : { ...l }));
  const rat = at + rng.int(10, 30) * DAY;
  e.remits.push({ version: 2, at: rat, lines, idPayer: first.idPayer, paymentRef: `${e.patient.payerId.toUpperCase()}-EFT-${new Date(rat).toISOString().slice(0, 10).replace(/-/g, "")}` });
}

// ── Metrics for calibration and the data report ──────────────────────────
export type Metrics = {
  claims: number;
  refusalRateByPayer: Record<string, number>;
  refusalRate: number;
  mnecValueShare: number;
  labLineRate: number;
  otherLineRate: number;
  labRatio: number;
  diabetesTests: { min: number; max: number; mean: number; median: number; hist: Record<number, number> };
  deniedByCode: Record<string, number>;
};

export function metrics(encs: SimEncounter[]): Metrics {
  const byPayer: Record<string, [number, number]> = {};
  let refused = 0;
  let mnec = 0;
  let deniedValue = 0;
  const lab = [0, 0];
  const other = [0, 0];
  const deniedByCode: Record<string, number> = {};
  const dm: number[] = [];
  for (const e of encs) {
    const first = e.remits[0];
    const isRef = first.lines.some((l) => l.denialCode);
    const bp = (byPayer[e.patient.payerId] ??= [0, 0]);
    bp[0]++;
    if (isRef) {
      bp[1]++;
      refused++;
    }
    for (const [i, l] of first.lines.entries()) {
      const line = e.lines[i];
      const bucket = line.kind === "lab" ? lab : other;
      bucket[0]++;
      if (l.denialCode) {
        bucket[1]++;
        const lost = l.net - l.paid;
        deniedValue += lost;
        if (l.denialCode.startsWith("MNEC")) mnec += lost;
        deniedByCode[l.denialCode] = (deniedByCode[l.denialCode] ?? 0) + 1;
      }
    }
    if (e.theme === "diabetes_followup") dm.push(e.lines.filter((l) => l.kind === "lab").length);
  }
  dm.sort((a, b) => a - b);
  const hist: Record<number, number> = {};
  for (const n of dm) hist[n] = (hist[n] ?? 0) + 1;
  const labRate = lab[1] / Math.max(1, lab[0]);
  const otherRate = other[1] / Math.max(1, other[0]);
  return {
    claims: encs.length,
    refusalRateByPayer: Object.fromEntries(Object.entries(byPayer).map(([k, [n, r]]) => [k, r / n])),
    refusalRate: refused / Math.max(1, encs.length),
    mnecValueShare: mnec / Math.max(1, deniedValue),
    labLineRate: labRate,
    otherLineRate: otherRate,
    labRatio: labRate / Math.max(1e-9, otherRate),
    diabetesTests: { min: dm[0] ?? 0, max: dm[dm.length - 1] ?? 0, mean: dm.reduce((s, n) => s + n, 0) / Math.max(1, dm.length), median: dm[Math.floor(dm.length / 2)] ?? 0, hist },
    deniedByCode,
  };
}

export const TARGETS = {
  refusalRate: [0.12, 0.18] as const,
  mnecValueShare: [0.45, 0.5] as const,
  labRatio: 3,
};

export function score(m: Metrics): number {
  const dist = (v: number, [lo, hi]: readonly [number, number]) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  const payerPen = Object.values(m.refusalRateByPayer).reduce((s, r) => s + dist(r, TARGETS.refusalRate), 0);
  return payerPen * 4 + dist(m.mnecValueShare, TARGETS.mnecValueShare) * 3 + Math.max(0, TARGETS.labRatio + 0.3 - m.labRatio) * 1.5 + Math.abs(m.refusalRate - 0.15) + Math.abs(m.mnecValueShare - 0.475) * 0.5;
}

export const FACILITY_ID = FACILITY.id;
