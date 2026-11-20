SEAL · POC system requirements (UAE hospital)
Nov 19, 2026 · @Nived krishna
SEAL is a working, end-to-end web system for a fictional Dubai hospital. It catches insurance claim refusals at three moments: while the doctor orders tests and writes the note, the instant a claim is created, and after a refusal comes back. It runs as one TypeScript app on Vercel, with every view reachable under one base URL.
1. Purpose and goals
The system must show, with live AI and real UAE claim formats, how refusals are prevented and recovered end to end. The evidence in section 3 shows that the largest preventable cause is tests and imaging ordered without documentation that justifies them, so that is the primary focus.
Goals the system must meet:
1.  Point of care. While the doctor writes the complaint and orders tests, SEAL checks each order against the documented complaint, diagnosis and insurer rules, and flags risks inline. The doctor corrects them in place, in their own words.
2.  Real-time claim check. The moment a claim is created, SEAL runs a full risk analysis and shows the result live: risk score, every finding, the rule behind it, and the exact fix.
3.  Doctor questions. Gaps that remain become a set of questions sized to the claim: as many as are needed, and no more. The doctor answers them in the doctor view (/doctor, shown as a phone). Answers are attached to the claim as a signed addendum and the claim is re-checked.
4.  Refusal recovery. Remittances with refusals land in a queue sorted by deadline and value. The AI drafts the correction or appeal; a biller approves it and it is resubmitted.
5.  Learning and AI health. Every outcome feeds a ledger. The system learns from it, proposes new rules, and an AI Health dashboard shows quality, drift, latency, cost and safety.
Quality bar:
• Real formats: DHA eClaimLink/DHPO claim and remittance structures, real UAE denial codes, ICD-10-CM and CPT codes.
• Live model calls, not canned text. Every finding cites its rule and quotes the note words it relied on.
• The SEAL logo and brand on every view.
• Everything reachable from one base URL, readable when screen-shared on Microsoft Teams at 1440 px wide.
Out of scope: real patient data, a real DHPO or Shafafiya connection, push notifications, messaging bots, regulatory certification, and billing patients.
2. POC vs production
The loop is identical in both. Only the judge changes: in the POC an agentic loop of frontier models makes the call, with Groq-hosted models as primary and Gemini as fallback; in production a model fine-tuned on the hospital's own history becomes the main judge, with a frontier model kept as explainer and critic.
Part
POC (this build)
Production
Refusal-risk judge
Groq-hosted reasoning model, with retrieved rules and similar past claims as evidence; Gemini on failure
Fine-tuned classifier trained on the hospital's claim outcomes; LLM explains its output
Live checks while typing
Groq fast model
Same small model, hosted in-region
Documentation and test-justification check
Groq reasoning model; Gemini on failure
In-region hosted model
Deterministic rules
Rule engine over a versioned JSON rule set
Same engine, curated by the billing team
Learning
Outcome ledger feeds retrieval memory and rule proposals; "retraining" means refreshing memory and calibration
Scheduled retraining and evaluation pipeline
Data
Synthetic, built from real public sources (section 11)
Real data, UAE-hosted, under the UAE Health Data Law
Requirements so the swap is a config change, not a rewrite:
• One Judge interface with two implementations: AgenticLLMJudge (built now) and TrainedModelJudge (a stub with the same inputs and outputs).
• Every judge call returns the same shape: refusal probability, top reasons, cited rule ids, evidence spans, confidence.
• AI Health names the active judge and can run a second judge in shadow mode on the same claims. The trained judge stays a labelled stub; no invented metrics for it.
• Model ids live in config. Claude Code checks the current Groq and Gemini model catalogues at build time and picks one reasoning model and one fast model on Groq, and one fallback model on Gemini.
3. UAE context and evidence
The evidence supports the field observation: tests and imaging ordered without documentation that justifies them are the most consistent preventable cause of refusals in the Gulf. The system's rules and synthetic data are built from these sources, not invented.
Finding
Figure
Source
UAE study of 598,000 claims (Dh263 m) from 10 providers: test claims for diabetes, hypertension, anaemia, thyroid and vitamin D disputed by insurers
Over 8.6% disputed; doctors ordered 2 to 12 tests for the same diabetes diagnosis
Gulf News, AccuMed 2011-12 study
Kuwait AFYA, 4.44 m claims 2016-2023: common reasons include tests or treatments not justified by the stated diagnosis
Overall 3.85% rejected; standalone laboratories 26.7%
Frontiers in Public Health, 2025
Saudi study of 203 refused claims at two hospitals
47.3% documentation issues, 52.7% policy and billing
Risk Management and Healthcare Policy, 2026
Daman diabetes lab guideline: allowed frequencies (HbA1c every 3 months, lipids yearly) and the codes used to refuse
MNEC-004, MNEC-005, DUPL-002, NCOV-003, PRCE-002
Daman guideline, 2025
Daman MRI/CT spine guideline: elective scans requested by a specialist; never as screening; repeat within 180 days refused unless new deficit
Criterion: progressive or persistent pain with neurologic deficit
Daman guideline V3
Daman vitamin D coverage limited to conditions such as osteoporosis, rickets, kidney disorders and malabsorption (older report)
Screening not covered
The National
Imaging and labs are investigative, so insurers scrutinise them most; examples: vitamin D, lipids, BNP, CT and MRI without conservative care
Qualitative
IMO Health
Dubai claims directive, effective 16 Nov 2025
Prior approval within 1 hour of the order; 2 resubmissions; initial payment within 45 days; resubmission paid within 30 days; 141-day adjudication cycle
Al Tamimi
UAE denial-code families: ELIG, AUTH, CODE, MNEC, DUPL, PRCE, NCOV, BENX, CLAI, COPY, TIME
About 40 common codes with meaning and fix (secondary source; verify against eClaimLink)
Zavis claim decoder
DHA claim and remittance structures
Published XSD documentation
eClaimLink DHD schemas
DoH Abu Dhabi adjudication rules: code sets, unbundling, medically unlikely edits, screening duplicates within 90 days
Rules apply to encounters from 1 Jan 2025
DoH Claims and Adjudication Rules V2025
What this means for the system:
• The point-of-care check on test and imaging orders is the primary feature, not a side panel extra.
• Every order must be justified by something in the note: a complaint, a finding, a diagnosis, a duration, a failed first treatment, or a time since the last test.
• The top refusal codes to model are MNEC-003 and MNEC-004 (not indicated), MNEC-005 (too frequent), DUPL-002 (repeat within the window), AUTH-001 (missing prior approval) and CODE-010 (does not fit the clinician's specialty).
Research Claude Code must still do before building (save to /research/<id>/ with a sources.md):
Id
Find
Output
R1
Full Claim.Submission and Remittance.Advice field lists from the eClaimLink DHD schema pages
Zod schemas and 2 sample XML files
R2
Official denial-code list from eClaimLink Codes and Lists (or DoH Shafafiya dictionary)
denial_codes.json, with any code not confirmed marked UNVERIFIED
R3
More published Daman adjudication guidelines (labs, imaging, physiotherapy, vitamins)
Rules in the rule DSL, each with its source link
R4
DoH adjudication rules: medically unlikely edits, unbundling, screening duplicates
Rules in the rule DSL
R5
ICD-10-CM and a small CPT subset for the hospital's specialties (CPT is AMA-licensed; keep it small)
codes/ JSON files
Never invent a regulatory fact. Regulators keep their real names; the hospital, insurers and people are fictional. Rules taken from Daman's public guidelines are applied to fictional insurers and labelled with their source.
4. Hospital, users and routes
The system serves Seabreeze Specialty Hospital, Dubai, a fictional 180-bed private hospital with orthopaedics, radiology, internal medicine, an emergency department and a lab. It bills four fictional insurers: Falcon Health, Crescent Care, Gulf Shield and Palm Assurance. Claude Code must check these names are not real UAE companies and change any that are.
Every user reaches their view by a path under one base URL. Login is a role picker; real authentication is out of scope.
User (fictional)
Role
Route
Needs
Dr. Omar Haddad
Orthopaedic consultant
/emr (desktop encounter screen) and /doctor (phone view)
Risks on his test orders while he writes; quick answers to questions later
Noura Al Mansoori
Billing officer
/billing (Hold, Ready, Submitted, Refused)
Why a claim will be refused, and the exact fix
Rania Fakhoury
Coding specialist
/rules
Rules she can trust, test and approve
Khalid Al Suwaidi
CFO
/clinic (finance dashboard)
Cash at risk, cash recovered, first-pass rate
Priya Nair
AI lead
/ai-health
Quality, drift, latency, cost, safety
Administrator
System admin
/admin
Seed data, reset, model and judge settings
How the system is viewed:
• It is shown by screen share on Microsoft Teams from one desktop browser. Every desktop view must read clearly at 1440 px wide.
• /doctor renders as a phone: a fixed 390 x 844 device frame centred on the page, so a desktop browser shows exactly what a doctor's phone would. It also works on a real phone at the same URL.
• A small route switcher (with the SEAL logo) lets the viewer jump between /emr, /doctor, /billing, /clinic, /ai-health, /rules and /system-map.
5. End-to-end flow
One claim passes seven stages. Stages 1, 4 and 6 put a person in the loop; nothing the AI proposes reaches a record or an insurer without someone confirming it.
Learning feeds back into the checks at stages 1 and 3, so a refusal pattern seen once is caught the next time.
1.  Point of care (/emr). The doctor records the patient's complaint as told, the findings, and the orders: tests, imaging, procedures, medicines. SEAL checks each order against what the note says.
    ◦ A fast check runs on every change (first result under 1 second); a deep check runs on a typing pause and on Sign.
    ◦ Each risk card names the order at risk, what the insurer needs to justify it (for example "symptom duration and prior treatment" for a lumbar MRI, or "a qualifying diagnosis" for vitamin D), the rule and its source, and the note words it read.
    ◦ The card offers fixes: add the missing detail through a template with blanks the doctor fills, link an existing diagnosis, or remove the order. Nothing is written for the doctor. The card turns green when resolved.
2.  Claim creation. When the encounter is signed, the claim is built in the DHA eClaimLink structure and validated against the schema. Codes come from the doctor and coder, never from the AI.
3.  Real-time check. The full risk analysis starts the instant the claim exists, and the claim view updates live as each check returns:
    ◦ Rule engine first (eligibility, prior approval, code edits, frequency windows, duplicates, contract price, filing deadline), usually in under 1 second.
    ◦ AI judge next: refusal probability per line and for the claim, with reasons that cite rules or past claims.
    ◦ Routing: low risk to Ready; high risk to Hold with the fix; open documentation gaps to stage 4.
4.  Doctor questions (/doctor). The question composer turns each open gap into one question, so a claim gets as many questions as it has gaps and no more (zero, one or several). Related gaps on the same order are merged into one question. Each question has structured fields (number, choice, short text) and an Arabic version.
    ◦ Questions appear in the doctor view within 2 seconds of creation. Answers save as the doctor fills them in.
    ◦ On submit, the answers are written as a signed addendum in the doctor's words, attached to the claim, and the claim is re-checked. It is released only when every question is answered or a biller overrides with a reason.
5.  Submission and adjudication (simulated). A mock post office accepts the XML. A mock insurer, with its own hidden rules built from the same public sources plus noise, returns a remittance advice after a configurable delay.
6.  Refusal recovery (/billing). Each refused line lands in the Refused queue with a deadline clock based on the Dubai directive. The recovery agent reads the denial code, the note, the addendum, the rules and past wins, and drafts a corrected resubmission or an appeal with evidence. A biller edits and approves; the resubmission goes back to the mock post office.
7.  Learning. Every outcome is written to the outcome ledger. The learning job updates retrieval memory, clusters new refusal patterns into rule proposals for approval in /rules, and re-runs the evaluation set. AI Health updates.
Domain events, one per transition, are stored in MongoDB and drive every live view: encounter.updated, order.checked, encounter.signed, claim.created, claim.check.started, claim.check.rule_result, claim.check.ai_result, claim.held, questions.created, question.answered, addendum.attached, claim.released, claim.submitted, remittance.received, denial.queued, draft.ready, resubmission.sent, outcome.recorded, rule.proposed, rule.approved, learning.cycle.completed.
6. System architecture
SEAL is one Next.js (App Router) project in TypeScript, deployed on Vercel. Pages, API route handlers and the simulators all live in it. The only things outside are MongoDB Atlas, the Groq API and the Gemini API.
Every AI call goes through one router that tries Groq first and falls back to Gemini; every piece of state lives in MongoDB.
Part
Path or module
What it does
EMR screen
/emr
Simulated hospital encounter screen with the SEAL panel
Doctor view
/doctor
Phone-framed list of open questions and the answer form
Billing
/billing, /billing/claims/[id]
Hold, Ready, Submitted and Refused queues; claim detail with live check
Clinic dashboard
/clinic
Finance view for the CFO
AI Health
/ai-health
Model quality, drift, operations, safety
Rules
/rules
Rule library, testing, proposals
System map
/system-map
Live picture of events moving through the system
Admin
/admin
Seed, reset, model and judge settings
API
/api/encounters, /api/claims, /api/claims/[id]/check (streamed), /api/questions, /api/remittances, /api/recovery, /api/rules, /api/learning/run, /api/events
Domain logic; each writes its events to MongoDB
Simulators
/api/mock/dhpo/*, /api/mock/insurer/*
Post office and insurer, logically outside SEAL
Libraries
lib/ai (router, agents, critic), lib/rules, lib/claims (XML build and validate), lib/learning, lib/db
Shared code used by the API routes
Requirements for running on Vercel:
• No Redis, no WebSockets, no background workers. Live updates come from two mechanisms: the claim check streams its results to the open claim view with Server-Sent Events as each check returns, and views that watch other users' actions (for example /doctor waiting for questions, /billing waiting for answers) poll /api/events?since=<cursor> every 1.5 seconds.
• Memory is a cache only. Rules, code lists and prompts may be cached in memory per function instance, loaded from MongoDB. Nothing that must persist or be shared between users lives only in memory, because Vercel may run several instances at once.
• Function time limits. Each agent call must finish within the Vercel function duration limit for the project's plan; set maxDuration per route and check current limits at build time. Long jobs (a learning cycle, a recovery draft) stream progress so the response stays open.
• Simulated delays without workers. The mock insurer stores a "ready at" time for each remittance. Any poll after that time triggers adjudication and returns the remittance, so the delay works with no scheduler.
• MongoDB Atlas holds all data, events, the outcome ledger and the AI call log. Use the Atlas Vector Search index for similar-claim retrieval.
Boundary rules:
• SEAL reads the EMR simulator's data through an adapter that behaves like a read-only feed. It writes back only two things: the doctor's own addendum and a hold flag. The System Map shows this boundary.
• Every model call is logged with prompt version, model, provider, tokens, latency, cost, fallback used and guardrail results. AI Health reads only this log and the ledger, so its numbers are real.
7. AI layer
Nine agents share one loop: plan, retrieve with tools, judge, critique, then act only through a person. Every agent runs on Groq by default and falls back to Gemini on error, timeout or rate limit; every output is a validated JSON object with citations.
Agent
Trigger
Groq model (Gemini fallback)
Output
Latency target
Order checker (live)
Each change to the complaint, findings or orders
Fast model
Candidate risk cards per order
under 1 s
Order justification checker (deep)
Typing pause, or Sign
Reasoning model
For each test or scan: justified or not, what is missing, evidence spans, fix template with blanks
under 6 s
Claim judge
claim.created
Reasoning model, with tools
Refusal probability per line and claim, top reasons, cited rules, confidence
under 5 s
Question composer
Gaps left after the check
Fast model
A question set sized to the gaps (0 to n), merged per order, English and Arabic, structured fields
under 2 s
Answer integrator
All questions answered
Reasoning model
Addendum (doctor's words kept verbatim), gap-resolved check per question, attachment mapping
under 5 s
Denial reader
remittance.received
Fast model
Denial family, likely root cause, recoverable or not
under 2 s
Recovery drafter
denial.queued
Reasoning model
Corrected claim as a diff, or an appeal letter, with evidence links
under 15 s
Rule miner
Learning cycle
Reasoning model
Proposed rules in the rule DSL, with supporting claims and counts
streamed
Critic
After every judge, checker, drafter and integrator call
A different Groq model from the one checked
Pass or fail: citations exist, no new clinical facts, no code changes, schema valid
under 2 s
Tools the agents may call: get_payer_rules, run_rule_engine, search_ledger (similar past claims and their outcomes), get_encounter, get_patient_history, get_prior_auth, check_eligibility, lookup_code, get_deadline.
The agentic loop for the claim judge:
1.  Plan which rules and history matter for this claim (payer, specialty, codes).
2.  Retrieve: rule-engine results, the payer's rules, the 10 most similar past claims with outcomes.
3.  Judge: score refusal risk and give reasons that each cite a rule id or a past claim id.
4.  Critique: a second model checks the reasoning against the evidence. If the two disagree, the claim is held for a person, labelled "low agreement".
5.  Act: write findings, route the claim, emit events. Maximum 6 tool steps, with a hard timeout and a fallback to rules-only scoring.
Model router: one config file per agent sets the Groq model, the Gemini fallback model, temperature, token limit, timeout and cost per token. A call falls back to Gemini on error, timeout or rate limit. Every fallback is logged and shown on AI Health. API keys come from GROQ_API_KEY and GEMINI_API_KEY.
Prompts live in /prompts/<agent>/<version>.md; each call logs its prompt version. Structured outputs use Gemini's response schema and Groq's JSON mode, validated with Zod; one retry on failure.
Guardrails, enforced in code, not just prompts:
• The AI never assigns or changes a code and never adds a diagnosis or clinical fact. The critic and a validator reject any output that does.
• Every finding must cite a rule id or a past claim and quote the note span it relied on; findings without a citation are dropped.
• Patient identifiers are masked before any model call. The data is synthetic, but the masking layer is real and shown on the System Map.
• A person confirms every write: the doctor's addendum, a released hold, a resubmission, an approved rule.
• A kill switch per agent in /admin falls back to rules only.
8. Data model
All data lives in one MongoDB Atlas database, in four groups: clinical source data (owned by the EMR simulator), claims, AI and learning records, and system records. Every document SEAL writes records who or what wrote it and when. Schemas are defined once in Zod and shared by the API and the UI.
Collection
Key fields
Notes
patients
_id, maskedId, name, dob, sex, emiratesIdMasked
Synthetic
members
patientId, payerId, planId, memberNo, validFrom, validTo
Insurance cover
payers, plans, contracts
name, plan rules, price per code
Fictional insurers
providers
name, specialty, licenseNo
Doctors
encounters
patientId, providerId, type, start, end, status, complaint (as told), findings, noteVersions[]
Every edit kept
orders
encounterId, kind (lab, imaging, procedure, drug), code, quantity, linkedDiagnoses[], justification status
The unit SEAL checks first
diagnoses
encounterId, icd10, primary, source (doctor or coder)
Source is never AI
priorAuths
memberId, codes, approvedQty, validTo, status

claims
encounterId, payerId, gross, net, status, versions[] (xml, resubmissionType, sentAt), riskScore, liveCheckState
One version per submission
findings
claimId or encounterId, orderId, stage, ruleId, pastClaimIds[], evidenceSpan, severity, probability, status
What SEAL flagged
questionSets
claimId, providerId, questions[] (gapId, orderId, textEn, textAr, fields[], answer, answeredAt), status, addendumId
Any number of questions per claim
rules
payerId, scope, dsl, sourceUrl, verified, version, author, approvedBy
Rule library with history
ruleProposals
clusterId, dsl, supportCount, exampleClaimIds[], status
From the rule miner
remittances, denials
xml, readyAt, receivedAt, claimId, activityId, denialCode, payerComment, amount
From the mock post office
recoveryDrafts
denialId, type (correction or appeal), diff, letter, evidence[], approvedBy, sentAt

outcomes (the ledger)
claimId, finalStatus, paid, refusedCodes[], fixesApplied[], daysToCash, predictedProbability, embedding
One per claim; Atlas Vector Search index on embedding
aiCalls
agent, provider, model, promptVersion, tokensIn, tokensOut, cost, latencyMs, status, fallbackUsed, criticResult, guardrailFlags[]
Feeds AI Health
evalSets, evalRuns
labelled claims; judge, precision, recall, calibration bins

judges, settings
active judge, shadow judge, model config, kill switches

events
seq (monotonic cursor), type, payload, actor, at
Drives live views and the System Map; indexed on seq
9. Screens
Eight views share one design language taken from the SEAL pitch deck: dark navy shell, green accent, serif headings (Source Serif 4), Archivo body text, light work surfaces, and Arabic with right-to-left layout on a toggle. Every AI element has a "why" link that opens its rule, evidence and model call.
Brand requirements:
• The SEAL wordmark ("SEAL" in bold serif with a green full stop) appears in the top bar of every desktop view, on the /doctor app header, as the favicon, and on the loading screen. Build it as an SVG component so it stays sharp.
• The route switcher sits beside the logo in the top bar.
Views:
1.  EMR encounter (/emr). Looks like a generic hospital EMR so SEAL reads as an add-on: patient banner with insurance badge, a "complaint as told by the patient" field, findings, diagnosis picker, and an orders panel (labs, imaging, procedures, medicines) with Sign.
    ◦ The SEAL panel on the right shows a status ring ("3 orders checked, 2 at risk") and one card per risky order: what the insurer needs, the rule and source, the highlighted note words, and fix actions.
    ◦ Each order row in the orders panel carries a small status dot (green, amber, red) that updates live.
2.  Doctor view (/doctor). Rendered inside a 390 x 844 phone frame on desktop; full screen on a real phone.
    ◦ Inbox: one card per claim with open questions, showing patient initials, visit time and "3 questions" (the real count).
    ◦ Question screen: one question per step with a progress indicator ("2 of 3"), the order it concerns, what the insurer needs, structured fields, and the Arabic line. Next, Back, and Submit all.
    ◦ Confirmation: the addendum exactly as it will be attached, for the doctor to confirm.
3.  Billing (/billing). Tabs: Hold, Ready, Submitted, Refused, each with counts.
    ◦ Claim detail (/billing/claims/[id]): a live check panel that fills in as results stream in (rules, then AI judge, then critic), a refusal-risk gauge per line and for the claim, findings with rule source and evidence, the question set and its status, the XML preview, and an event timeline.
    ◦ Refused tab: queue sorted by deadline then value, a countdown per line, the AI draft next to the original as a diff, and Approve and resubmit.
4.  Clinic dashboard (/clinic). First-pass acceptance rate, cash at risk, cash recovered, days to cash, top refusal reasons by insurer and by order type (labs, imaging, procedures), with a clear "synthetic data" badge.
5.  AI Health (/ai-health). See section 10.
6.  Rules (/rules). Rule library with source links and a verified or unverified badge; versions; "test this rule" against history showing how many claims it would have caught; proposals from the rule miner with supporting claims and Approve or Reject.
7.  System map (/system-map). A live diagram of the app's parts. Each event animates as a pulse along its edge, with a scrolling event log beside it. The read-only boundary and the identifier masking step are drawn on it.
8.  Admin (/admin). Seed the database, reset to the seeded state, set the insurer delay, choose the active and shadow judge, switch an agent's model, and turn agents off (rules-only fallback).
10. Learning module and AI Health
SEAL learns through three paths, all fed by the outcome ledger, and the AI Health dashboard computes every number from logged model calls and real ledger rows, never from mocks.
The three learning paths:
1.  Memory. Each finished claim, its outcome and its fix are embedded. The claim judge retrieves the most similar ones as evidence, so new outcomes change the next decision immediately.
2.  Rule mining. The learning worker clusters refusals by insurer, code, denial family and note pattern. A cluster above a threshold (for example 8 refusals in 30 days with no matching rule) becomes a proposed rule in the DSL, sent to Rules Studio for a person to approve.
3.  Evaluation and calibration. A labelled evaluation set (300 claims, held out) is re-scored after each cycle. Calibration maps the judge's raw probability to observed refusal rates per insurer.
AI Health and Rules both have a "Run learning cycle" action. It shows new outcomes counted, clusters found, a proposed rule, the evaluation re-run, and the before-and-after metrics.
AI Health dashboard panels:
Panel
Shows
Computed from
Quality
Hold precision (held claims that really needed a fix), refusal recall (refusals SEAL caught), first-pass rate with SEAL vs the seeded baseline
Ledger, evaluation runs
Calibration
Predicted risk vs actual refusal rate, in 10 bins
Evaluation runs
Agreement
Judge vs critic agreement; biller accept vs override rate; doctor answer rate and time to answer
ai_calls, findings, questions
Drift
Change in insurer, specialty and code mix; new denial codes not seen before; refusal-reason mix this week vs last
Ledger, denials
Operations
p50 and p95 latency per agent, error and fallback rate, tokens and cost per claim, split by Gemini and Groq
ai_calls
Safety
Guardrail blocks (invented facts, code changes, missing citations), masking checks passed, critic rejections
ai_calls
Versions
Active judge, shadow judge, prompt versions, rule-set version, last learning cycle
judges, rule_versions, eval_runs
Alerts
Thresholds crossed, such as precision under 50%, p95 latency over target, fallback rate over 10%
All of the above
Thresholds come from the pitch's pilot criteria: hold precision at least 50%, doctor answer rate at least 60%. Show them as reference lines on the charts.
11. Synthetic data and seeded scenarios
Synthetic data is built by a pipeline from real public sources, never generated blindly. Every rule, rate and denial code in the seed traces to a source in /research, and any value without a source is labelled an assumption in the seed config and on /admin.
Sources and what each one feeds:
Source
Feeds
MTSamples: about 5,000 real de-identified transcription samples across 40 specialties, CC0 licence
The wording and content of complaints, findings and plans. Use orthopaedics, radiology, general medicine and lab-heavy notes, adapted to a Dubai outpatient setting
Daman adjudication guidelines (diabetes labs, MRI/CT spine, plus those found in R3)
SEAL's rule set and the mock insurer's hidden rules
DoH Claims and Adjudication Rules V2025
Code edits: medically unlikely units, unbundling, screening duplicates within 90 days
eClaimLink DHD schemas (R1) and the official denial-code list (R2)
The structure of every claim and remittance, and the code on every refusal
AccuMed UAE study (Gulf News)
Test-ordering behaviour: 2 to 12 tests for the same diabetes diagnosis; over 8.6% of test claims disputed
Kuwait AFYA study; Saudi documentation study
Refusal mix: labs refused far more often than other lines; about half of refusals are documentation-related
Calibration targets for the 12-month history:
Parameter
Target
Basis
First-pass refusal rate by insurer
12% to 18%
Assumption inside the published 15-25% Saudi range; UAE totals not published
Share of refused value from medical-necessity and documentation codes (MNEC)
45% to 50%
Saudi study: 47.3% documentation-related
Refusal rate on lab lines vs other lines
Lab lines at least 3x higher
AFYA: standalone labs 26.7% vs hospitals 3.89%
Tests per diabetes encounter
2 to 12, skewed low
AccuMed UAE study
Frequency limits
HbA1c every 3 months; lipids yearly; spine MRI repeat within 180 days refused without new deficit
Daman guidelines
Screening duplicates
Same screening test within 90 days refused
DoH rules
Generation pipeline (TypeScript scripts in scripts/seed, run once; output committed as compressed JSON so deploys never regenerate):
1.  Load the research outputs: rules, codes, denial codes, schemas.
2.  Build encounter templates from MTSamples: the LLM rewrites each chosen sample into a structured Dubai outpatient encounter (complaint as told, findings, diagnoses, orders), keeping the original clinical content.
3.  Inject documentation gaps deliberately, one rule at a time, at the calibrated rates (for example remove the symptom duration from an MRI encounter, or order vitamin D without a qualifying diagnosis), and record the ground truth for each.
4.  Adjudicate the history with the mock insurer's hidden rules plus noise, producing remittances with real denial codes.
5.  Produce about 20,000 claims over 12 months (sized for the Atlas free tier's storage), plus a held-out evaluation set of 300.
6.  Validate and write /research/data-report.md: every claim schema-valid, every denial code in the official list, every rate inside its target, and 20 sample claims printed for a person to read.
The mock insurer's rules overlap SEAL's but are not identical, and it adds noise, so SEAL genuinely predicts rather than reading the answer key.
Seeded scenarios (each tied to a source):
Scenario
What happens
Codes
Source
S1 Lumbar MRI at a first visit
Complaint has no duration, no conservative treatment, no neurologic finding; two risk cards at point of care; doctor adds the detail
MNEC-003
Daman MRI/CT spine
S2 Diabetes follow-up
HbA1c repeated 6 weeks after the last one, plus C-peptide ordered; two risk cards; doctor removes C-peptide and records why HbA1c is repeated
MNEC-005, MNEC-004
Daman diabetes labs
S3 Routine check-up
Vitamin D ordered with no qualifying diagnosis; risk card offers to link a documented diagnosis or remove the order
MNEC-004
Daman vitamin D coverage
S4 Physiotherapy x 6
Prior approval covers 4 sessions; held by the rule engine with the exact fix
AUTH-005
Prior-approval rule
S5 Three claims, three question sets
After sign-off, one claim has 3 gaps (3 questions), one has 1, one has none, showing the question count follows the claim
MNEC-003, MNEC-004
Rule set
S6 Abdominal CT refused
Coded as unspecified abdominal pain though the note documents right-lower-quadrant pain and fever; refused; recovery drafts the appeal with the note evidence; resubmitted and paid
MNEC-003
IMO Health example
S7 New insurer pattern
Gulf Shield starts refusing lipid panels repeated within 12 months for patients without diabetes; 9 refusals arrive; the miner proposes a rule; it is approved; the next such order is caught at point of care
MNEC-005
Rule miner
S8 Repeat screening test
The same screening test within 90 days; held before sending
DUPL-002
DoH rules
The S7 pattern is written into the mock insurer only, so SEAL learns it from outcomes.
12. Build guide for Claude Code
One Next.js project in TypeScript only, deployed to Vercel, built in eight phases. Each phase ends with its acceptance checks passing.
Stack:
• Next.js (App Router), TypeScript, Tailwind CSS and shadcn/ui; ECharts for dashboards; React Flow for the System Map.
• MongoDB Atlas through the official MongoDB Node.js driver; Atlas Vector Search for similar-claim retrieval.
• Groq SDK (primary) and Google Gen AI SDK (fallback); Zod for every schema and every model output.
• XML built and parsed in TypeScript and validated against the R1 field rules.
• Server-Sent Events for the live claim check; /api/events polling for cross-view updates. No Redis, no WebSockets, no push notifications, no messaging bots.
• Environment variables: GROQ_API_KEY, GEMINI_API_KEY, MONGODB_URI, MONGODB_DB, APP_BASE_URL.
Repo layout:
seal/
  app/
    emr/  doctor/  billing/  clinic/  ai-health/  rules/  system-map/  admin/
    api/  encounters/  claims/  questions/  remittances/  recovery/
          rules/  learning/  events/  mock/dhpo/  mock/insurer/  admin/
  components/        SEAL logo, route switcher, phone frame, shared UI
  lib/ai/            router (Groq, then Gemini), agents, critic, prompts
  lib/rules/         rule DSL and engine
  lib/claims/        eClaimLink XML build, parse, validate
  lib/learning/      ledger, clustering, rule miner, evaluation
  lib/db/            MongoDB client, Zod schemas, indexes
  prompts/           versioned prompts per agent
  config/models.ts   model router settings
  research/          R1-R5 outputs with sources, data-report.md
  scripts/seed/      data pipeline (section 11); output committed as JSON
Build phases:
1.  Research. R1-R5 complete, every source cited, unverified items flagged.
2.  Data. Zod schemas, MongoDB collections and indexes, the seed pipeline and its data report.
3.  Claims core. Claim builder producing valid eClaimLink XML; mock post office and mock insurer returning remittances with lazy delay.
4.  Real-time check. Rule engine, claim judge with critic, streamed results, /billing with live claim detail.
5.  Point of care. /emr with the orders panel and the SEAL panel: live and deep order checks.
6.  Doctor questions. Question composer producing sets of any size, /doctor phone view, answer integrator, addendum attached, re-check.
7.  Recovery and learning. Remittance ingestion, denial reader, recovery drafter, resubmission; outcome ledger, rule miner, /rules, evaluation runs, /ai-health.
8.  Finish. /clinic, /system-map, /admin, Arabic layout, SEAL branding everywhere, Vercel deployment.
Acceptance checks:
[ ] The app deploys to Vercel from the repo with only the five environment variables, and every route works under one base URL.
[ ] Every claim and resubmission XML passes the R1 field rules; every denial code shown exists in the R2 list.
[ ] Every seeded rule links to its source; the data report shows every calibration target met.
[ ] On /emr, a risk card for an unjustified test appears within 1 second of entering the order.
[ ] On claim creation, the first rule results show within 1 second and the AI judgement within 5 seconds, streamed into the open claim view.
[ ] The question set always matches the open gaps: scenario S5 produces exactly 3, 1 and 0 questions.
[ ] Questions reach /doctor within 2 seconds; the addendum appears on the claim within 3 seconds of Submit.
[ ] With Groq disabled, every agent still works through Gemini, and AI Health shows the fallbacks.
[ ] No AI output ever changes a code or adds a clinical fact; a test suite of adversarial notes proves it.
[ ] AI Health numbers match direct queries on aiCalls and outcomes.
[ ] The SEAL logo appears on every view, the favicon and the doctor app header.
[ ] All insurers, people and the hospital are fictional; regulators keep their real names; nothing claims a real partnership or real patient data.
