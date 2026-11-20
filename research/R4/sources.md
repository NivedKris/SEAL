# R4 — DoH adjudication rules (MUE, unbundling, screening duplicates)

**Output:** [rules/doh-adjudication.json](rules/doh-adjudication.json) — 5 rules in the SEAL rule DSL.

## Source

**DoH Claims & Adjudication Rules, V2025.1** — Department of Health, Abu Dhabi.
[pdf](https://www.doh.gov.ae/-/media/Feature/shafifya/Prices/Adjudication-Rules/DOH-Claims-and-Adjudication-Rules-V20251.ashx) · 72 pages · sha256 `3626da8842706940…` · downloaded 2026-11-19.
(The DoH server omits its intermediate certificate; the download was verified against GlobalSign "GCC R46 OV TLS CA 2025" fetched from the certificate's own AIA URL — TLS verification was not disabled.)

| Rule | Section | Denial code |
|---|---|---|
| DOH-EM-FOLLOWUP-7D | 4.2.1.3 E&M services not separately reimbursable | PRCE-006 *(inferred; UNVERIFIED code)* |
| DOH-VENIPUNCTURE-INHOUSE | 4.2.1.7 | PRCE-002 *(inferred)* |
| DOH-VENIPUNCTURE-CONTRAST | 4.2.1.7 | PRCE-002 *(inferred)* |
| DOH-SCREENING-DUP-90D | 4.5.3 Comprehensive screening codes | DUPL-002 *(inferred)* |
| DOH-MUE | 5.2 Medically Unlikely Edit | MNEC-005 *(inferred)* |

## Caveats

- These are **Abu Dhabi** rules. SEAL's hospital is in **Dubai** (DHA). They are applied to the fictional insurers as an assumption, labelled with their source. A Dubai equivalent was not found.
- DoH names **no denial codes** for these edits; each chosen code is explained in the rule's `notes`.
- **Screening duplicates:** DoH's text is specific to IFHAS vs other Thiqa screening programmes and handles them by *recovery*. SEAL generalises it to any screening encounter so scenario S8 can hold the claim with DUPL-002.
- **MUE table not yet loaded.** DoH publishes MUE values in the Mandatory Tariff workbook ("Tab MUE"). Only DoH's own example (CPT 44970 = 1) is encoded. DoH also says insurers *opt* to use MUEs by contract.
- Section 5.3 "Abu Dhabi Insurers Simple Edits" is "(Reserved for Future Use)" in V2025.1 — nothing to extract.
