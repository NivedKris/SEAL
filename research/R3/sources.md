# R3 — Insurer adjudication guidelines (labs, imaging, therapy, vitamins)

**Output:** [rules/](rules/) — 25 rules in the SEAL rule DSL ([lib/rules/dsl.ts](../../lib/rules/dsl.ts)). Each rule carries its source URL, version, section and a short verbatim quote.

Rules from Daman's public guidelines are applied to SEAL's **fictional** insurers (Falcon Health, Crescent Care, Gulf Shield, Palm Assurance) and say so. Daman's guidelines state they "may not be copied, reproduced, distributed", so the repo keeps only short quotes, links and file hashes — not the documents or full text.

## Sources

| Document | Ref / version / revised | Used for | sha256 (first 16) |
|---|---|---|---|
| Daman — Diabetes Mellitus Lab Tests [pdf](https://www.damanhealth.ae/wp-content/uploads/2025/11/DM-lab-test_Adjudication-Guideline-External-Instruction-Template_V1R0.pdf) | 2013-MN-0012 · v3.1 · 2025-11-10 | HbA1c 3-monthly; lipids, UACR yearly; TSH (T1DM); B12 on metformin; C-peptide/insulin not necessary; home A1C not covered; asymptomatic testing | `571c394e8338bf16` |
| Daman — MRI & CT Spine (current) [pdf](https://www.damanhealth.ae/wp-content/uploads/2026/01/MRI-CT-Spine-External-Guideline.pdf) | 2013-MN-0014 · v4.1 · 2025-12-12 | Screening not covered; 180-day repeat; specialist for elective; combined contrast code | `ce6321418472330c` |
| Daman — MRI & CT Spine (older) [pdf](https://www.damanhealth.ae/wp-content/uploads/2025/09/MRI-and-CT-Scan-Spine-V3.0.pdf) | 2013-MN-0014 · v3.0 · 2019-11 | Back-pain criterion: "Progressive/persistent pain with profound or progressive neurologic deficit" | `b380b062dec893e8` |
| Daman — ESWT [pdf](https://www.damaninsurance.ae/wp-content/uploads/2026/06/Extracorporeal-Shockwave-Therapy-in-Musculoskeletal-Indications-External-16062026.pdf) | 2016-MN-0012 · v3.0 · 2026-06-16 | 4 indications; 6 months + failed conservative care; 6 sessions; eligible specialties | `43f15270602c6af1` |
| Daman — Occupational Therapy [pdf](https://www.damanhealth.ae/wp-content/uploads/2025/09/Occupational-Therapy-external-updated.pdf) | 2022-MN-066 · v2.1 · 2025-05-30 | Group therapy not covered; re-evaluation criteria | `74f853925b5aa643` |
| Daman — Ambulatory ECG [pdf](https://damanhealth.ae/wp-content/uploads/2025/01/Ambulatory-ECG-Monitoring-External-Instruction-Template_V1R0.pdf) | 2022-BR-032 · v1.1 · 2024-12-31 | Routine ECG not with Holter; eligible specialties | `86dcff2109c159a1` |
| DoH Abu Dhabi — THIQA Coverage Policy on Vitamin D Deficiency [pdf](https://www.doh.gov.ae/-/media/EAB3C65E8B614555870BA764A495C2C2.ashx) | DOH/Pol/CPL/1/2022 · 2022-07 | Qualifying conditions/medicines for testing; re-test at 12 weeks, max 2/year | `113ff6bba08a4d87` |
| The National — "UAE national health insurer drops tests for vitamin D deficiency" [article](https://www.thenationalnews.com/uae/health/uae-national-health-insurer-drops-tests-for-vitamin-d-deficiency-1.140148) | undated | Corroboration only (Daman limits vitamin D tests to conditions such as osteoporosis, rickets, kidney disorders) | — |
| Al Tamimi — "Dubai issues comprehensive overhaul of health insurance claims management framework" (2025-11-05), read via [Legal500](https://www.legal500.com/intelligence/united-arab-emirates/insurance/dubai-issues-comprehensive-overhaul-of-health-insurance-claims-management-framework) | — | Prior-approval request within 1 hour of the order (SEAL-PA-MISSING insurer-needs text) | — |

## Status of each rule

- **24 rules `verified: true`** — built directly from the primary text quoted in the rule.
- **1 rule `verified: false`** — `SEAL-PA-MISSING`: which services need prior approval is an **assumption** for the fictional plans; no public Daman list was found.
- **5 rules with `denialCodeBasis: "inferred"`** — the document states the rule but not the code (or its code list lacks a fitting one); the chosen code is explained in `notes`.
- Rules whose condition is SEAL's reading of the text say so in `notes` (UACR CKD exception, TSH in type 2, ESWT "per policy" = 365 days).

## Not found

- **Physiotherapy session limits** (Daman): no public guideline found. Scenario S4 uses the generic prior-approval quantity rule instead.
- **Daman's own vitamin D guideline**: not found; DoH's THIQA policy is used and labelled.
- Daman's guideline library page was not crawled; more guidelines (e.g. knee MRI, CT abdomen) can be added the same way.
