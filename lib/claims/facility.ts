/** The (fictional) hospital SEAL runs in. Must match scripts/seed/world.ts FACILITY. */
export const FACILITY = { id: "DHA-F-SEAL001", name: "Seabreeze Specialty Hospital", nameAr: "مستشفى سيبريز التخصصي" } as const;

/** Assumption (research/data-report.md): resubmission window per refused line. The Dubai directive caps resubmissions at 2. */
export const RESUBMISSION_WINDOW_DAYS = 60;
export const MAX_RESUBMISSIONS = 2;
/** Assumption: filing deadline from the encounter date. */
export const FILING_DEADLINE_DAYS = 90;
