# R1 — Claim.Submission and Remittance.Advice field lists

**Output:** Zod schemas in [lib/claims/schema.ts](../../lib/claims/schema.ts), XML parse/build in [lib/claims/xml.ts](../../lib/claims/xml.ts), and two samples in [samples/](samples/). Checked by `npx tsx scripts/research/validate.ts`.

## Sources

| # | Source | What it gave | Access | sha256 (first 16) |
|---|---|---|---|---|
| 1 | DHA `CommonTypes.xsd` v2.0 (Liquid XML generated), public mirror at `https://whatsapp.cosmopolitanhospitals.in/XML/Schema/CommonTypes.xsd` (dated 2016-07-05) | Every field's type, format (`dd/mm/yyyy HH:MM`), length limits, enums (EncounterType, ActivityType, DiagnosisType, ResubmissionType, ObservationType, Emirates ID pattern and placeholders) and DHA's own field descriptions | Downloaded 2026-11-19 | `3ba2f81e196073c1` |
| 2 | Green Rain Health — "Claim.Submission DHA" template (Confluence page 1111916548), https://greenrainhealth.atlassian.net/wiki/x/BIBGQg | Field list per worksheet with Mandatory Yes/No; current enum additions (EncounterType 10, 41, 42; ActivityType 9 DRG; ObservationType Result/ROM/ExcludeFromDRG; DxInfo POA codes) | Read via Confluence REST API, 2026-11-19 | — |
| 3 | Green Rain Health — "Remittance.Advice DHA" template (page 1111851058), https://greenrainhealth.atlassian.net/wiki/x/MoBFQg | Remittance field list with Mandatory flags (PaymentReference, IDPayer and PaymentAmount required; DenialCode optional) | Same | — |
| 4 | `lisnast19/ghaf-app` — `backend/app/services/dhpo_parser.py` (GitHub, no licence) | Corroborates XML element nesting as DHPO files use it: `Claim/ID`, `Claim/Encounter/FacilityID`, `Claim/Activity/PriorAuthorizationID`, `Activity/Observation/ValueType`, `Activity/PaymentAmount`, `Activity/DenialCode`, `Claim/DateSettlement` | Read only, 2026-11-19 | — |
| 5 | eClaimLink DHD schema pages, `https://eclaimlink.ae/dhd/*.html` | Official element pages | **Not read** — site serves a CAPTCHA to automated requests | — |

## Reliability

- Types and formats are from DHA's own XSD (primary), but the copy is a third-party mirror and from 2016. Newer enum values come from Green Rain's current templates (secondary) and are accepted by the schema as well.
- Element nesting is secondary (Green Rain worksheets + a working DHPO parser). It matches the CommonTypes naming (`ClaimGross` → `Claim/Gross`, `ActivityNet` → `Activity/Net`).

## Open items

- **UNVERIFIED:** root-element namespace / `schemaLocation` attributes. Samples omit them; the parser strips prefixes.
- **UNVERIFIED:** the official `Claim.Submission.xsd` / `Remittance.Advice.xsd` occurrence rules (only Green Rain's Mandatory flags were seen). Confirm against eclaimlink.ae DHD pages with a logged-in browser session.
- The checks `Claim.Net = Σ Activity.Net`, `Gross − PatientShare = Net`, one Principal diagnosis, and "underpaid activity must carry a DenialCode" are **SEAL consistency checks** derived from the field definitions, not stated XSD rules.
