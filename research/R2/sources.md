# R2 — Denial codes

**Output:** [denial_codes.json](denial_codes.json) — 100 codes; **13 VERIFIED**, 87 **UNVERIFIED**.

## How status is set

- **VERIFIED** — the code *and* its description appear in a regulator or insurer document we downloaded and read (listed in each code's `confirmedIn`).
- **UNVERIFIED** — the code is only in the secondary list below. It is still usable in the simulator, but nothing in SEAL may present it as confirmed.

## Sources

| Source | Codes confirmed | sha256 (first 16) |
|---|---|---|
| Daman — Diabetes Mellitus Lab Tests guideline v3.1 (2025-11-10) [pdf](https://www.damanhealth.ae/wp-content/uploads/2025/11/DM-lab-test_Adjudication-Guideline-External-Instruction-Template_V1R0.pdf) | CLAI-012, DUPL-002, MNEC-004, MNEC-005, NCOV-003, PRCE-002 | `571c394e8338bf16` |
| Daman — MRI & CT Spine guideline v4.1 (2025-12-12) [pdf](https://www.damanhealth.ae/wp-content/uploads/2026/01/MRI-CT-Spine-External-Guideline.pdf) | MNEC-003, MNEC-004, AUTH-001, AUTH-005, NCOV-003, PRCE-010, CODE-010 | `ce6321418472330c` |
| Daman — ESWT guideline v3.0 (2026-06-16) [pdf](https://www.damaninsurance.ae/wp-content/uploads/2026/06/Extracorporeal-Shockwave-Therapy-in-Musculoskeletal-Indications-External-16062026.pdf) | MNEC-003, MNEC-004, CODE-010 | `43f15270602c6af1` |
| Daman — Occupational Therapy guideline v2.1 (2025-05-30) [pdf](https://www.damanhealth.ae/wp-content/uploads/2025/09/Occupational-Therapy-external-updated.pdf) — states these are "Regulator denial codes" | MNEC-003, MNEC-004, MNEC-005, NCOV-003, AUTH-001 | `74f853925b5aa643` |
| Daman — Ambulatory ECG guideline v1.1 (2024-12-31) [pdf](https://damanhealth.ae/wp-content/uploads/2025/01/Ambulatory-ECG-Monitoring-External-Instruction-Template_V1R0.pdf) | NCOV-003, CODE-010, MNEC-003/004/005 | `86dcff2109c159a1` |
| DoH Abu Dhabi — Shafafiya Business Rules (updated 2018-03-08) [pdf](https://www.doh.gov.ae/-/media/Feature/shafifya/BusinessRulesMASTER21.ashx) | AUTH-003, AUTH-004 | `cf2970cd81a7814d` |
| **Secondary:** `lisnast19/ghaf-app` `backend/app/data/denial_codes.json` (GitHub, no licence; codes and descriptions are regulator text, used as factual data) — the full 100-code list incl. `effective_to` dates | (list only) | `695b2720e6fe479e` |

Not reachable: eClaimLink Codes and Lists → Denial (`eclaimlink.ae`, CAPTCHA); Shafafiya dictionary "Other Codes" (`shafafiyaportal.doh.gov.ae`, broken TLS chain and JS-rendered).

## Notes

- Every code in the plan's target list — MNEC-003, MNEC-004, MNEC-005, DUPL-002, AUTH-001, CODE-010 — is **VERIFIED**, as are AUTH-005, NCOV-003, PRCE-002 and PRCE-010 used by the scenarios.
- `typicalFix` is SEAL-authored guidance, not regulator text.
- One Daman table (ECG guideline) prints MNEC-003 with garbled wording that overlaps MNEC-005; the clean descriptions in the diabetes and spine guidelines were used.
