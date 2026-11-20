# SEAL

SEAL catches insurance claim refusals at three moments for the fictional **Seabreeze Specialty Hospital, Dubai**: while the doctor writes (/emr), the instant a claim exists (/billing), and after a refusal comes back (Refused queue). Built to plan.md; all data is synthetic.

## Run it

```bash
npm install                 # .npmrc skips the onnxruntime CUDA download
npm run dev                 # or: npx next build && npx next start
```

Environment (`.env`): `GROQ_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `MONGODB_URI`, optional `MONGODB_DB` (default `seal`) and `APP_BASE_URL`.

## Data

```bash
npm run seed:generate        # rebuild the committed seed from the templates (no API calls)
npm run seed:load -- --reset # validate, storage-guard and load into MongoDB "seal", embed outcomes (~25 min)
```

`/admin → Reset` returns the demo to the seeded state in seconds (live data removed, scenarios S1–S8 restored). Research sources and the data report: `research/README.md`, `research/data-report.md`.

## Views

| Route | Who | What |
|---|---|---|
| /emr | Doctor | Encounter screen with the SEAL panel: live (rules + fast model) and deep order checks, risk cards, fix templates |
| /doctor | Doctor (phone) | Questions sized to the claim's gaps, EN/AR, answers become a signed addendum |
| /billing | Billing officer | Hold / Ready / Submitted / Refused; live claim check streamed over SSE; recovery drafts |
| /clinic | CFO | First-pass rate, cash at risk and recovered, days to cash, refusal reasons |
| /ai-health | AI lead | Quality, calibration, agreement, drift, operations, safety, versions, alerts — from logged calls |
| /rules | Coding specialist | Rule library with sources, test against history, miner proposals, learning cycle |
| /system-map | Everyone | Live diagram; every event pulses along its edge |
| /admin | Admin | Reset, insurer delay, judges, Groq kill switch, per-agent model and kill switches, assumptions |

## Checks

Scripts that import server code need `NODE_OPTIONS=--conditions=react-server` (the npm scripts set it).

```bash
npm run research:validate
npm run check:insurer        # XML validity + live mock insurer vs seeded refusal rates
npm run check:phase3         # claim → post office → lazy remittance → S6 correction
npm run check:phase4         # real-time check on S1–S8 copies (add --no-groq for the Gemini path)
npm run check:phase5         # point-of-care order checks
npm run check:phase6         # S5 gives 3/1/0 questions; addendum verbatim; re-check
npm run check:phase7         # S6 recovery, S7 rule mined → caught at /emr, AI Health = direct queries
npm run check:phase4:http -- http://localhost:3000 S1   # SSE timings against a running server
```

## Deploy (Vercel)

1. Import the project into Vercel (or `npx vercel deploy --prod`), Node 22.
2. Set the environment variables above in the Vercel project.
3. MongoDB Atlas → Network Access: allow Vercel's egress (0.0.0.0/0 for the POC).
4. The local embedding model (Xenova/bge-small-en-v1.5, ~34 MB) downloads to `/tmp` on a cold start; ONNX binaries for other platforms are excluded from the function bundle (next.config.ts).

Known limits: Groq's free tier allows 8,000 tokens/minute per model — a third claim checked within a minute falls back to Gemini (30–60 s). Model prices in `config/models.ts` are unverified.
