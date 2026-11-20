# R5 — Diagnosis and procedure codes

**Output:** [codes/](codes/)

| File | Content |
|---|---|
| `icd10cm_2027_full.json.gz` | All 74,879 billable ICD-10-CM FY2027 codes with descriptions (dotted form, e.g. `M54.50`) |
| `icd10cm_2027_seal.json` | 29,619-code subset for the hospital's specialties (musculoskeletal, endocrine/metabolic, symptoms, injuries, CKD, GI, Z-codes…) |
| `cpt_seal_subset.json` | 82 CPT codes with **SEAL-written plain-language labels** |

## Sources

- **ICD-10-CM FY2027** — CMS, "2027 Code Descriptions in Tabular Order", https://www.cms.gov/files/zip/2027-code-descriptions-tabular-order.zip (effective 2026-10-01; sha256 `91c6c9d1117764ce…`). Public domain (US government work).
- **CPT** — code numbers only, as they appear in the public Daman and DoH documents cited in R3/R4. CPT® is a registered trademark of the AMA; official descriptors are licensed and **not** reproduced. A licensed CPT file is needed before production.

## Notes

- FY2027 changed codes the rules use: `M72.2` (plantar fascial fibromatosis) is now split into `M72.20/.21/.22`. The ESWT rule uses `M72.2*`; `scripts/research/validate.ts` checks every diagnosis pattern in every rule against the billable list.
- **UNVERIFIED:** which ICD-10-CM release DHA/eClaimLink currently mandates. No DHA circular was found. SEAL uses the newest US release.
