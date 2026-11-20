# SEAL research (build phase 1)

Every rule, code and format SEAL uses traces to a file here. Run the consistency check with:

```bash
npx tsx scripts/research/validate.ts
```

| Id | Output | Status |
|---|---|---|
| [R1](R1/sources.md) | Zod schemas ([lib/claims/schema.ts](../lib/claims/schema.ts)), XML parse/build ([lib/claims/xml.ts](../lib/claims/xml.ts)), 2 sample XML files | Done. Formats from DHA CommonTypes.xsd; nesting secondary. Root namespace UNVERIFIED. |
| [R2](R2/sources.md) | `denial_codes.json` — 100 codes | Done. 13 VERIFIED (incl. every code the scenarios use), 87 UNVERIFIED. |
| [R3](R3/sources.md) | 25 rules from Daman guidelines + DoH vitamin D policy | Done. 24 verified, 1 assumption. Physiotherapy session limits not found. |
| [R4](R4/sources.md) | 5 rules from DoH Claims & Adjudication Rules V2025.1 | Done. Abu Dhabi rules applied to Dubai as an assumption; MUE table not loaded. |
| [R5](R5/sources.md) | ICD-10-CM FY2027 (full + subset), 82-code CPT subset | Done. CPT labels are SEAL-written. DHA's adopted ICD version UNVERIFIED. |

Rule DSL: [lib/rules/dsl.ts](../lib/rules/dsl.ts).

## Fact check of plan.md §3

| Plan statement | Result | Source |
|---|---|---|
| AccuMed: 598,000 claims, Dh263 m, 10 providers, over 8.6% disputed; 2–12 tests per diabetes diagnosis | **Confirmed.** (The National prints Dh236 m — likely a typo.) The 2–12 figure is from a sub-analysis of 25,844 diabetes cases. | [Gulf News](https://gulfnews.com/uae/health/study-reveals-cost-of-dispute-in-medical-claims-1.1199853), [Emirates 24/7](https://www.emirates247.com/news/emirates/doctors-over-charging-dh20m-disputable-bills-2013-06-23-1.511459) |
| Kuwait AFYA: 4.44 m claims 2016–2023, 3.85% rejected, standalone labs 26.7%, unjustified tests a common reason | **Confirmed** (labs 2,038 / 7,633 = 26.70%; hospitals 3.89%) | [Frontiers in Public Health 2025, PMC12321863](https://pmc.ncbi.nlm.nih.gov/articles/PMC12321863/) |
| Saudi: 203 refused claims, 2 hospitals, 47.3% documentation / 52.7% policy & billing | **Confirmed** (2023–24 data, Eastern Province public hospitals) | [Risk Manag Healthc Policy vol 19, 2026](https://www.dovepress.com/optimizing-health-insurance-claims-processing-the-role-of-clinical-doc-peer-reviewed-fulltext-article-RMHP) |
| Daman diabetes labs: HbA1c every 3 months, lipids yearly; codes MNEC-004, MNEC-005, DUPL-002, NCOV-003, PRCE-002 | **Confirmed**, plus CLAI-012. Also names C-peptide as not medically necessary (scenario S2). | R3 |
| Daman spine: specialist for elective, never screening, 180-day repeat unless new deficit; persistent pain with neuro deficit | **Confirmed.** The deficit criterion is in v3.0; current v4.1 is less explicit. | R3 |
| Daman vitamin D limited to osteoporosis, rickets, kidney disorders, malabsorption | **Confirmed only by an undated news report.** A stronger primary source was found: DoH THIQA vitamin D policy (2022). | R3 |
| Dubai directive, 16 Nov 2025: prior approval within 1 hour of the order; 2 resubmissions; 45 / 30 days; 141-day cycle | **Confirmed.** Also: insurer must answer elective outpatient requests within 6 h, inpatient 24 h, emergencies immediately; delay fee 0.03%/day of net claimed; fines AED 10k–50k. | [Al Tamimi via Legal500](https://www.legal500.com/intelligence/united-arab-emirates/insurance/dubai-issues-comprehensive-overhaul-of-health-insurance-claims-management-framework) |
| DoH rules: code sets, unbundling, MUE, screening duplicates within 90 days | **Confirmed** (V2025.1). The 90-day rule is specific to IFHAS vs other Thiqa screening. "Applies to encounters from 1 Jan 2025" **not checked**. | R4 |
| Insurer and hospital names are fictional | **Confirmed** — no UAE company found for Falcon Health, Crescent Care, Gulf Shield, Palm Assurance or Seabreeze Specialty Hospital. "Gulf Shield" is close to the real *GIG Gulf*; consider renaming. | web search 2026-11-19 |

## Synthetic data (phase 2)

[data-report.md](data-report.md) — every calibration target, refusal sources, 20 sample claims and the assumptions list. Pipeline:

```bash
npm run seed:templates -- <mtsamples.jsonl> 7   # LLM: MTSamples → encounter templates (committed: scripts/seed/data/)
npm run seed:generate                           # → scripts/seed/output/seed.json.gz + this report (no API calls)
npm run seed:load -- --reset                    # validate, storage-guard, load into MongoDB "seal", embed outcomes
```

MTSamples source: the Argilla copy on Hugging Face (`argilla/medical-domain`, 4,966 rows; the original Kaggle dataset is CC0). Two GitHub mirrors (`aneuraz/mtsamplesFR`, `salgadev/medical-nlp`) are truncated and were not used. The answer key (injected gaps, concept spans, insurer reasons) is in `scripts/seed/output/ground-truth.json.gz`; only the eval set's and scenarios' keys are loaded into the `groundTruth` collection, which agents never read.

## Open items for later phases

1. eClaimLink DHD pages and the official denial list sit behind a CAPTCHA — confirm R1 occurrence rules and the 87 UNVERIFIED codes from a logged-in browser.
2. Load the DoH MUE table from the Mandatory Tariff workbook (R4).
3. Contract prices for the fictional insurers: not researched yet (needed for PRCE rules and claim amounts in phase 2). The DoH Mandatory Tariff is the obvious public base.
4. A licensed CPT descriptor file before any production use.
5. Model pricing in `config/models.ts` is still unverified (affects AI Health cost panels).
6. **API limits (measured 2026-11-19):** Groq allows 8,000 tokens/minute per model on this key; the Gemini key's generation quota was exhausted (429) while embeddings still worked. The live app and the "Groq disabled → Gemini" acceptance check need higher limits.
7. The DoH Mandatory Tariff workbook (prices, MUE table) is behind a Shafafiya login; prices are assumptions.
