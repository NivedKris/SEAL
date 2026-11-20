/**
 * Seed steps 3–6 (plan §11): generate ~20,000 claims over 12 months + a 300-claim
 * held-out evaluation set, calibrate to the research targets, validate, and write
 *   scripts/seed/output/seed.json.gz   (committed; deploys never regenerate)
 *   research/data-report.md
 *
 *   npx tsx scripts/seed/generate.ts [total=20300]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { SEED_RULES, RULE_SET_VERSION } from "@/lib/rules/library";
import { buildClaimSubmission, buildRemittanceAdvice } from "@/lib/claims/xml";
import type { ClaimSubmission, RemittanceAdvice } from "@/lib/claims/schema";
import { NATIONALITIES } from "./names";
import { ASSUMPTIONS, BASE_PRICES, FACILITY, PAYERS, PLANS, PROVIDERS, SEED_VERSION, THEMES } from "./world";
import { buildPlan, metrics, score, simulate, TARGETS, kindOf, PAYER_STRICTNESS, type Params, type SimEncounter, type Metrics } from "./sim";
import { DAY, Rng, dubaiIso, eclaimDateTime, dateMs } from "./rng";
import type { Template } from "./build-templates";
import { SCENARIOS, S6, priceFor, planFor } from "./scenarios";

const ROOT = join(__dirname, "../..");
const SEED = 20261119;
const NOW = dateMs("2026-11-17") + 9 * 3600_000; // data "as of" the build
const SEED_ACTOR = { kind: "seed" as const, id: SEED_VERSION };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Join segments into note text and record each segment's offsets (ground truth only). */
function joinSegments(segs: { id: string; part: "complaint" | "findings"; text: string; concepts: string[] }[]) {
  const out = { complaint: "", findings: "", spans: [] as { id: string; part: string; start: number; end: number; concepts: string[] }[] };
  for (const sg of segs) {
    const key = sg.part;
    if (out[key]) out[key] += " ";
    const start = out[key].length;
    out[key] += sg.text;
    out.spans.push({ id: sg.id, part: key, start, end: out[key].length, concepts: sg.concepts });
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const allowMissing = argv.includes("--allow-missing");
  const total = Number(argv.find((a) => /^\d+$/.test(a)) ?? 20300);
  const templates: Template[] = JSON.parse(readFileSync(join(ROOT, "scripts/seed/data/templates.json"), "utf8"));
  const icd = new Map((JSON.parse(gunzipSync(readFileSync(join(ROOT, "research/R5/codes/icd10cm_2027_full.json.gz"))).toString()) as { codes: { code: string; description: string }[] }).codes.map((c) => [c.code, c.description]));
  const cpt = new Map((JSON.parse(readFileSync(join(ROOT, "research/R5/codes/cpt_seal_subset.json"), "utf8")) as { codes: { code: string; label: string }[] }).codes.map((c) => [c.code, c.label]));
  const denialList = new Map((JSON.parse(readFileSync(join(ROOT, "research/R2/denial_codes.json"), "utf8")) as { codes: { code: string; description: string; status: string }[] }).codes.map((c) => [c.code, c]));
  const missingThemes = Object.keys(THEMES).filter((t) => !templates.some((x) => x.theme === t));
  if (missingThemes.length && !allowMissing) throw new Error(`no templates for themes: ${missingThemes.join(", ")}`);
  if (missingThemes.length) console.log(`WARNING: no templates yet for ${missingThemes.join(", ")} (dev run)`);
  console.log(`${templates.length} templates, ${SEED_RULES.length} rules`);

  // ── 1. Plan + calibration on a subsample ─────────────────────────────
  const plan = buildPlan(total, SEED, NATIONALITIES);
  console.log(`plan: ${plan.patients.length} patients, ${plan.visits.length} visits`);
  // Coordinate descent over the generator parameters on a 4,000-claim subsample.
  const evalP = (p: Params) => {
    const m = metrics(simulate(plan, templates, SEED_RULES, p, SEED, 6000).encounters);
    return { p, s: score(m), m };
  };
  // Grid over the three levers that matter; the rest are fixed (see report).
  let best = evalP({ gapScale: 0.5, imagingGapScale: 0.15, noiseScale: 1, paMissing: 0.04, bloat: 0.08, coderMiss: 0.1 });
  for (const gapScale of [0.35, 0.5, 0.65])
    for (const bloat of [0.08, 0.14])
      for (const paMissing of [0.01, 0.02])
        for (const imagingGapScale of [0.1, 0.25, 0.4, 0.6]) {
          const r = evalP({ ...best.p, gapScale, bloat, paMissing, imagingGapScale, noiseScale: 0.8 });
          if (r.s < best.s) best = r;
        }
  // Then pull each insurer toward 15% by scaling its enforcement (two rounds, larger sample).
  for (let round = 0; round < 2; round++) {
    const strictness = { ...PAYER_STRICTNESS, ...best.p.strictness };
    for (const [payer, rate] of Object.entries(best.m.refusalRateByPayer)) strictness[payer] = Math.min(1.6, Math.max(0.4, strictness[payer] * Math.pow(0.15 / rate, 1.2)));
    const m = metrics(simulate(plan, templates, SEED_RULES, { ...best.p, strictness }, SEED, 10000).encounters);
    best = { p: { ...best.p, strictness }, s: score(m), m };
  }
  console.log(`  best: refusal ${(best.m.refusalRate * 100).toFixed(1)}% mnec ${(best.m.mnecValueShare * 100).toFixed(1)}% lab ${best.m.labRatio.toFixed(2)}x payers ${Object.values(best.m.refusalRateByPayer).map((x) => (x * 100).toFixed(1)).join("/")}`);
  console.log(`calibrated params ${JSON.stringify(best.p)} (score ${best.s.toFixed(4)})`);

  // ── 2. Full run ──────────────────────────────────────────────────────
  const { encounters } = simulate(plan, templates, SEED_RULES, best.p, SEED);
  const rng = new Rng(SEED + 1);
  const recent = encounters.filter((e) => e.at > dateMs("2026-08-15") && !e.scenario);
  rng.shuffle(recent).slice(0, 300).forEach((e) => (e.evalSet = true));
  const history = encounters.filter((e) => !e.evalSet);
  const m = metrics(history);
  console.log(`full: ${encounters.length} encounters (${history.length} history + ${encounters.length - history.length} eval)`);

  // ── 3. Documents ─────────────────────────────────────────────────────
  const writtenAt = dubaiIso(NOW);
  const prov = { writtenBy: SEED_ACTOR, writtenAt };
  const providers = PROVIDERS.map((p, i) => ({ ...p, licenseNo: `DHA-P-SEAL${String(101 + i).padStart(4, "0")}`, ...prov }));
  const licence = new Map(providers.map((p) => [p._id, p.licenseNo]));
  const payers = PAYERS.map((p) => ({ _id: p._id, name: p.name, nameAr: p.nameAr, eclaimLinkId: p.eclaimLinkId, fictional: true as const, ...prov }));
  const eclaimId = new Map<string, string>(PAYERS.map((p) => [p._id, p.eclaimLinkId]));
  const plans = PLANS.map((p) => ({ _id: p._id, payerId: p.payerId, name: p.name, benefits: p.benefits, priorAuthRequired: p.priorAuthRequired, copayPct: p.copayPct, ...prov }));
  const contracts = PAYERS.map((p) => ({
    _id: `contract-${p._id}`,
    payerId: p._id,
    priceFactor: p.priceFactor,
    prices: Object.fromEntries(Object.entries(BASE_PRICES).map(([c, v]) => [c, Math.round(v * p.priceFactor)])),
    filingDeadlineDays: 90,
    ...prov,
  }));

  const usedPatients = new Map(encounters.map((e) => [e.patient.id, e.patient]));
  const eid = (id: string, dob: string) => {
    const h = sha(id);
    const seven = (parseInt(h.slice(0, 8), 16) % 10_000_000).toString().padStart(7, "0");
    return `784-${dob.slice(0, 4)}-${seven}-${parseInt(h.slice(8, 9), 16) % 10}`;
  };
  const patients: Record<string, unknown>[] = [...usedPatients.values()].map((p) => {
    const e = eid(p.id, p.dob);
    return {
      _id: p.id,
      maskedId: `P-${sha(p.id).slice(0, 6).toUpperCase()}`,
      name: `${p.first} ${p.family}`,
      dob: p.dob,
      sex: p.sex,
      nationality: p.nationality,
      emiratesId: e,
      emiratesIdMasked: `784-****-*****${e.slice(-4)}`,
      ...prov,
    };
  });
  const eidById = new Map(patients.map((p) => [p._id as string, p.emiratesId as string]));
  const members: { _id: string; patientId: string; payerId: string; planId: string; memberNo: string; validFrom: string; validTo: string }[] = [...usedPatients.values()].map((p) => ({
    _id: p.memberId,
    patientId: p.id,
    payerId: p.payerId,
    planId: p.planId,
    memberNo: `${p.payerId.slice(0, 2).toUpperCase()}-${p.id.slice(4).padStart(7, "0")}-01`,
    validFrom: new Date(p.validFrom).toISOString().slice(0, 10),
    validTo: new Date(p.validTo).toISOString().slice(0, 10),
    ...prov,
  }));
  const memberNo = new Map(members.map((m) => [m._id, m.memberNo]));

  const encDocs: unknown[] = [];
  const orderDocs: unknown[] = [];
  const dxDocs: unknown[] = [];
  const paDocs: unknown[] = [];
  const claimDocs: unknown[] = [];
  const remitDocs: unknown[] = [];
  const denialDocs: unknown[] = [];
  const outcomeDocs: unknown[] = [];
  /** Answer key: never read by SEAL agents; used by evaluation and the data report only. */
  const gtDocs: unknown[] = [];
  const evalLabels: Record<string, { refused: boolean; denialCodes: string[] }> = {};
  let xmlChecked = 0;

  for (const e of encounters) {
    const at = dubaiIso(e.at);
    const { complaint, findings, spans } = joinSegments(e.segments);
    gtDocs.push({
      _id: e.id,
      claimId: e.claimId,
      segments: spans,
      gaps: e.gaps,
      injected: e.injected,
      insurerReasons: e.remits[0].lines.filter((l) => l.denialCode).map((l) => ({ activityId: l.activityId, code: l.code, denialCode: l.denialCode, source: l.source })),
    });
    encDocs.push({
      _id: e.id,
      patientId: e.patient.id,
      memberId: e.patient.memberId,
      providerId: e.providerId,
      facilityId: FACILITY.id,
      type: e.encounterType,
      start: at,
      end: dubaiIso(e.at + (e.encounterType === 2 ? 150 : 25) * 60_000),
      status: "claimed",
      complaint,
      findings,
      plan: e.plan,
      noteVersions: [],
      templateId: e.templateId,
      theme: e.theme,
      evalSet: e.evalSet,
      ...(e.scenario ? { scenario: e.scenario } : {}),
      ...prov,
    });
    for (const [i, d] of e.diagnoses.entries())
      dxDocs.push({ _id: `${e.id}-dx${i + 1}`, encounterId: e.id, icd10: d.code, primary: d.primary, source: "coder", ...prov }); // description looked up from the ICD list
    for (const l of e.lines) {
      if (l.kind !== "visit")
        orderDocs.push({
          _id: `${e.id}-o${l.activityId}`,
          encounterId: e.id,
          kind: l.kind,
          activityType: 3,
          code: l.code,
          label: cpt.get(l.code) ?? l.code,
          quantity: l.quantity,
          linkedDiagnoses: e.diagnoses.filter((d) => d.primary).map((d) => d.code),
          justificationStatus: "unchecked",
          orderedAt: at,
          ...prov,
        });
      if (l.priorAuth)
        paDocs.push({
          _id: `${e.id}-pa${l.activityId}`,
          memberId: e.patient.memberId,
          encounterId: e.id,
          codes: [l.code],
          approvedQty: l.priorAuth.approvedQty,
          requestedAt: dubaiIso(e.at + 20 * 60_000),
          validTo: new Date(e.at + 30 * DAY).toISOString().slice(0, 10),
          status: "approved",
          authNo: l.priorAuth.authNo,
          ...prov,
        });
    }

    // Claim (+ XML validation for v1 and the first remittance).
    const lines = e.lines.map((l) => ({
      activityId: l.activityId,
      orderId: l.kind === "visit" ? undefined : `${e.id}-o${l.activityId}`,
      activityType: 3,
      code: l.code,
      quantity: l.quantity,
      net: l.net,
      clinician: licence.get(e.providerId)!,
      priorAuthId: l.priorAuth?.authNo,
      start: at,
    }));
    const gross = Math.round(e.lines.reduce((s, l) => s + l.price * l.quantity, 0) * 100) / 100;
    const net = Math.round(e.lines.reduce((s, l) => s + l.net, 0) * 100) / 100;
    const sub: ClaimSubmission = {
      Header: { SenderID: FACILITY.id, ReceiverID: eclaimId.get(e.patient.payerId)!, TransactionDate: eclaimDateTime(e.submittedAt), RecordCount: 1, DispositionFlag: "PRODUCTION" },
      Claim: [
        {
          ID: e.claimNo,
          MemberID: memberNo.get(e.patient.memberId),
          PayerID: eclaimId.get(e.patient.payerId)!,
          ProviderID: FACILITY.id,
          EmiratesIDNumber: eidById.get(e.patient.id)!,
          Gross: gross,
          PatientShare: Math.round((gross - net) * 100) / 100,
          Net: net,
          Encounter: { FacilityID: FACILITY.id, Type: e.encounterType, PatientID: `MRN-${e.patient.id.slice(4)}`, Start: eclaimDateTime(e.at), StartType: e.encounterType === 2 ? 2 : 1 },
          Diagnosis: e.diagnoses.map((d) => ({ Type: d.primary ? "Principal" : "Secondary", Code: d.code })),
          Activity: lines.map((l) => ({ ID: l.activityId, Start: eclaimDateTime(e.at), Type: 3, Code: l.code, Quantity: l.quantity, Net: l.net, Clinician: l.clinician, PriorAuthorizationID: l.priorAuthId })),
        },
      ],
    };
    buildClaimSubmission(sub); // throws on any R1 field-rule violation
    const ra: RemittanceAdvice = {
      Header: { SenderID: eclaimId.get(e.patient.payerId)!, ReceiverID: FACILITY.id, TransactionDate: eclaimDateTime(e.remits[0].at), RecordCount: 1, DispositionFlag: "PRODUCTION" },
      Claim: [
        {
          ID: e.claimNo,
          IDPayer: e.remits[0].idPayer,
          ProviderID: FACILITY.id,
          PaymentReference: e.remits[0].paymentRef,
          DateSettlement: eclaimDateTime(e.remits[0].at),
          Activity: e.remits[0].lines.map((r, i) => ({ ID: r.activityId, Start: eclaimDateTime(e.at), Type: 3, Code: r.code, Quantity: e.lines[i].quantity, Net: r.net, Clinician: licence.get(e.providerId)!, PaymentAmount: r.paid, DenialCode: r.denialCode })),
        },
      ],
    };
    buildRemittanceAdvice(ra);
    xmlChecked += 2;
    for (const r of e.remits) for (const l of r.lines) if (l.denialCode && !denialList.has(l.denialCode)) throw new Error(`denial code ${l.denialCode} not in R2 list`);

    // Final state.
    const first = e.remits[0];
    const final = new Map(first.lines.map((l) => [l.activityId, l]));
    for (const r of e.remits.slice(1)) for (const l of r.lines) final.set(l.activityId, l);
    const paid = Math.round([...final.values()].reduce((s, l) => s + l.paid, 0) * 100) / 100;
    const deniedFirst = first.lines.filter((l) => l.denialCode);
    const recentQueued = deniedFirst.length > 0 && e.resubmissions.length === 0 && first.at > NOW - 35 * DAY;
    const lost = [...final.values()].filter((l) => l.denialCode);
    const status = recentQueued ? "refused" : !deniedFirst.length ? "paid" : lost.length ? "closed" : "paid";

    claimDocs.push({
      _id: e.claimId,
      claimNo: e.claimNo,
      encounterId: e.id,
      patientId: e.patient.id,
      memberId: e.patient.memberId,
      payerId: e.patient.payerId,
      providerId: e.providerId,
      gross,
      patientShare: Math.round((gross - net) * 100) / 100,
      net,
      status,
      versions: [
        { version: 1, lines, sentAt: dubaiIso(e.submittedAt) },
        ...e.resubmissions.map((rs) => ({
          version: rs.version,
          resubmissionType: rs.type,
          comment: rs.comment,
          lines: lines.filter((l) => e.remits[1]?.lines.some((x) => x.activityId === l.activityId)),
          sentAt: dubaiIso(rs.at),
        })),
      ],
      riskScore: null,
      liveCheckState: "idle",
      createdAt: dubaiIso(e.submittedAt - 3600_000),
      evalSet: e.evalSet,
      ...(e.scenario ? { scenario: e.scenario } : {}),
      ...prov,
    });
    for (const r of e.remits)
      remitDocs.push({
        _id: `${e.claimId}-ra${r.version}`,
        claimId: e.claimId,
        claimVersion: r.version,
        payerId: e.patient.payerId,
        idPayer: r.idPayer,
        paymentReference: r.paymentRef,
        readyAt: dubaiIso(r.at),
        receivedAt: dubaiIso(r.at),
        lines: r.lines.map((l) => ({ activityId: l.activityId, code: l.code, net: l.net, paymentAmount: l.paid, ...(l.denialCode ? { denialCode: l.denialCode } : {}) })),
        ...prov,
      });
    for (const l of deniedFirst) {
      const after = final.get(l.activityId)!;
      const resub = e.resubmissions.length > 0 && e.remits[1]?.lines.some((x) => x.activityId === l.activityId);
      denialDocs.push({
        _id: `${e.claimId}-den${l.activityId}`,
        remittanceId: `${e.claimId}-ra1`,
        claimId: e.claimId,
        activityId: l.activityId,
        code: l.code,
        denialCode: l.denialCode,
        family: l.denialCode!.split("-")[0],
        amount: Math.round((l.net - l.paid) * 100) / 100,
        deadline: dubaiIso(first.at + 60 * DAY),
        status: recentQueued ? "queued" : resub ? (after.denialCode ? "lost" : "won") : "written_off",
        ...prov,
      });
    }

    if (e.evalSet) {
      evalLabels[e.claimId] = { refused: deniedFirst.length > 0, denialCodes: deniedFirst.map((l) => l.denialCode!) };
      continue;
    }
    const lastPaid = e.remits.filter((r) => r.lines.some((l) => l.paid > 0)).at(-1);
    const payerName = PAYERS.find((p) => p._id === e.patient.payerId)!.name;
    const refusedTxt = deniedFirst.map((l) => {
      const g = e.gaps.find((x) => x.code === l.code);
      return `${l.denialCode} on ${l.code} ${cpt.get(l.code) ?? ""}${g ? ` (note lacked: ${g.concepts.join(", ")})` : ""}`;
    });
    outcomeDocs.push({
      _id: e.claimId,
      claimId: e.claimId,
      payerId: e.patient.payerId,
      specialty: e.specialty,
      theme: e.theme,
      codes: e.lines.map((l) => l.code),
      diagnoses: e.diagnoses.map((d) => d.code),
      finalStatus: recentQueued ? "refused" : !lost.length ? "paid" : paid > 0 ? "partially_paid" : "refused",
      gross,
      paid,
      firstPassRefused: deniedFirst.length > 0,
      refusedCodes: [...new Set(deniedFirst.map((l) => l.denialCode!))],
      refusedLines: deniedFirst.map((l) => ({ code: l.code, denialCode: l.denialCode!, amount: Math.round((l.net - l.paid) * 100) / 100, recovered: !final.get(l.activityId)!.denialCode })),
      fixesApplied: e.resubmissions.flatMap((r) => r.fixes),
      daysToCash: lastPaid ? Math.round((lastPaid.at - e.submittedAt) / DAY) : null,
      predictedProbability: null,
      summary: [
        `Insurer: ${payerName}. Specialty: ${e.specialty}. Visit type: ${e.encounterType === 2 ? "emergency" : "outpatient"}.`,
        `Diagnoses: ${e.diagnoses.map((d) => `${d.code} ${icd.get(d.code) ?? ""}`).join("; ")}.`,
        `Services: ${e.lines.map((l) => `${l.code} ${cpt.get(l.code) ?? ""}${l.quantity > 1 ? ` x${l.quantity}` : ""}`).join("; ")}.`,
        `Note: ${e.segments.flatMap((s) => s.concepts).filter((c, i, a) => a.indexOf(c) === i).join(", ") || "no documentation markers"}.`,
        deniedFirst.length ? `Refused: ${refusedTxt.join("; ")}.` : "Paid on first submission.",
        e.resubmissions.length ? `Resubmitted: ${e.resubmissions[0].comment}. Result: ${lost.length ? "partly lost" : "recovered"}.` : "",
      ].filter(Boolean).join(" "),
      closedAt: recentQueued ? null : dubaiIso(e.remits.at(-1)!.at),
      ...prov,
    });
  }

  // ── Scenarios S1–S8 ────────────────────────────────────────────────
  const scenarioIndex: { id: string; title: string; encounterId?: string; claimId?: string; expect: string }[] = [];
  const addPatient = (key: string, p: (typeof SCENARIOS)[number]["patient"]) => {
    const id = `pat-${key}`;
    const e = eid(id, p.dob);
    patients.push({ _id: id, maskedId: `P-${sha(id).slice(0, 6).toUpperCase()}`, name: `${p.first} ${p.family}`, dob: p.dob, sex: p.sex, nationality: p.nationality, emiratesId: e, emiratesIdMasked: `784-****-*****${e.slice(-4)}`, ...prov });
    const memberId = `mem-${key}`;
    members.push({ _id: memberId, patientId: id, payerId: p.payerId, planId: `${p.payerId}-${p.plan}`, memberNo: `${p.payerId.slice(0, 2).toUpperCase()}-${key.padStart(7, "0")}-01`, validFrom: "2025-01-01", validTo: "2027-06-30", ...prov });
    return { id, memberId, eid: e };
  };
  const checkDx = (code: string) => {
    if (!icd.has(code)) throw new Error(`scenario diagnosis ${code} is not billable ICD-10-CM FY2027`);
  };
  for (const sc of SCENARIOS) {
    const pt = addPatient(sc.id, sc.patient);
    const planDoc = planFor(sc.patient.payerId, sc.patient.plan);
    for (const [hi, h] of (sc.history ?? []).entries()) {
      const at = NOW - h.daysAgo * DAY;
      const hid = `enc-${sc.id}-h${hi + 1}`;
      checkDx(h.dx);
      encDocs.push({ _id: hid, patientId: pt.id, memberId: pt.memberId, providerId: sc.providerId, facilityId: FACILITY.id, type: 1, start: dubaiIso(at), status: "claimed", complaint: "Routine follow-up.", findings: "See plan.", noteVersions: [{ version: 1, complaint: "Routine follow-up.", findings: "See plan.", editedBy: { kind: "emr", id: sc.providerId }, editedAt: dubaiIso(at) }], theme: h.theme, evalSet: false, scenario: sc.id, ...prov });
      dxDocs.push({ _id: `${hid}-dx1`, encounterId: hid, icd10: h.dx, description: icd.get(h.dx)!, primary: true, source: "coder", ...prov });
      const lines = h.codes.map((code, i) => ({ activityId: String(i + 1), activityType: 3, code, quantity: 1, net: Math.round(priceFor(code, sc.patient.payerId) * (1 - planDoc.copayPct) * 100) / 100, clinician: licence.get(sc.providerId)!, start: dubaiIso(at) }));
      const net = Math.round(lines.reduce((s, l) => s + l.net, 0) * 100) / 100;
      const gross = Math.round(h.codes.reduce((s, c) => s + priceFor(c, sc.patient.payerId), 0) * 100) / 100;
      const cid = `clm-${sc.id}-h${hi + 1}`;
      claimDocs.push({ _id: cid, claimNo: `SSH-2026-${sc.id}H${hi + 1}`, encounterId: hid, patientId: pt.id, memberId: pt.memberId, payerId: sc.patient.payerId, providerId: sc.providerId, gross, patientShare: Math.round((gross - net) * 100) / 100, net, status: "paid", versions: [{ version: 1, lines, sentAt: dubaiIso(at + DAY) }], riskScore: null, liveCheckState: "idle", createdAt: dubaiIso(at + DAY - 3600_000), evalSet: false, scenario: sc.id, ...prov });
      remitDocs.push({ _id: `${cid}-ra1`, claimId: cid, claimVersion: 1, payerId: sc.patient.payerId, idPayer: `${sc.patient.payerId.slice(0, 2).toUpperCase()}-CLM-${sc.id}H${hi + 1}`, paymentReference: `${sc.patient.payerId.toUpperCase()}-EFT-${sc.id}H${hi + 1}`, readyAt: dubaiIso(at + 21 * DAY), receivedAt: dubaiIso(at + 21 * DAY), lines: lines.map((l) => ({ activityId: l.activityId, code: l.code, net: l.net, paymentAmount: l.net })), ...prov });
    }
    const at = NOW - sc.daysAgo * DAY + 3600_000;
    const eidc = `enc-${sc.id}`;
    sc.diagnoses.forEach((d) => checkDx(d.code));
    const { complaint, findings, spans } = joinSegments(sc.segments);
    gtDocs.push({ _id: eidc, segments: spans, gaps: [], injected: [], expect: sc.expect });
    encDocs.push({ _id: eidc, patientId: pt.id, memberId: pt.memberId, providerId: sc.providerId, facilityId: FACILITY.id, type: sc.encounterType, start: dubaiIso(at), status: "open", complaint, findings, plan: sc.plan, noteVersions: [{ version: 1, complaint, findings, plan: sc.plan, editedBy: { kind: "emr", id: sc.providerId }, editedAt: dubaiIso(at) }], theme: sc.title, evalSet: false, scenario: sc.id, ...prov });
    sc.diagnoses.forEach((d, i) => dxDocs.push({ _id: `${eidc}-dx${i + 1}`, encounterId: eidc, icd10: d.code, description: icd.get(d.code)!, primary: d.primary, source: "doctor", ...prov }));
    sc.orders.forEach((o, i) => orderDocs.push({ _id: `${eidc}-o${i + 1}`, encounterId: eidc, kind: o.kind, activityType: 3, code: o.code, label: o.label, quantity: o.qty ?? 1, linkedDiagnoses: sc.diagnoses.filter((d) => d.primary).map((d) => d.code), justificationStatus: "unchecked", orderedAt: dubaiIso(at), ...prov }));
    (sc.priorAuths ?? []).forEach((pa, i) => paDocs.push({ _id: `${eidc}-pa${i + 1}`, memberId: pt.memberId, encounterId: eidc, codes: [pa.code], approvedQty: pa.approvedQty, requestedAt: dubaiIso(at - 2 * DAY), validTo: new Date(at + 30 * DAY).toISOString().slice(0, 10), status: "approved", authNo: `PA-${sc.patient.payerId.slice(0, 2).toUpperCase()}-${sc.id}-${i + 1}`, ...prov }));
    scenarioIndex.push({ id: sc.id, title: sc.title, encounterId: eidc, expect: sc.expect });
  }
  {
    // S6: refused abdominal CT already in the Refused queue.
    const pt = addPatient("S6", S6.patient);
    const at = NOW - S6.daysAgo * DAY + 2 * 3600_000;
    const eidc = "enc-S6";
    S6.diagnoses.forEach((d) => checkDx(d.code));
    const { complaint, findings, spans } = joinSegments(S6.segments);
    gtDocs.push({ _id: eidc, claimId: "clm-S6", segments: spans, gaps: [], injected: ["unspecified_abdominal_pain_coded"], expect: S6.expect });
    encDocs.push({ _id: eidc, patientId: pt.id, memberId: pt.memberId, providerId: S6.providerId, facilityId: FACILITY.id, type: 2, start: dubaiIso(at), end: dubaiIso(at + 150 * 60_000), status: "claimed", complaint, findings, plan: S6.plan, noteVersions: [{ version: 1, complaint, findings, plan: S6.plan, editedBy: { kind: "emr", id: S6.providerId }, editedAt: dubaiIso(at) }], theme: "abdominal_pain_er", evalSet: false, scenario: "S6", ...prov });
    S6.diagnoses.forEach((d, i) => dxDocs.push({ _id: `${eidc}-dx${i + 1}`, encounterId: eidc, icd10: d.code, description: icd.get(d.code)!, primary: d.primary, source: "coder", ...prov }));
    const lines = S6.codes.map((code, i) => ({ activityId: String(i + 1), orderId: code.startsWith("992") ? undefined : `${eidc}-o${i + 1}`, activityType: 3, code, quantity: 1, net: priceFor(code, S6.patient.payerId), clinician: licence.get(S6.providerId)!, start: dubaiIso(at) }));
    lines.forEach((l) => l.orderId && orderDocs.push({ _id: l.orderId, encounterId: eidc, kind: kindOf(l.code), activityType: 3, code: l.code, label: cpt.get(l.code)!, quantity: 1, linkedDiagnoses: ["R10.9"], justificationStatus: "unchecked", orderedAt: dubaiIso(at), ...prov }));
    const net = Math.round(lines.reduce((s, l) => s + l.net, 0) * 100) / 100;
    const sentAt = at + DAY;
    const sub: ClaimSubmission = {
      Header: { SenderID: FACILITY.id, ReceiverID: eclaimId.get(S6.patient.payerId)!, TransactionDate: eclaimDateTime(sentAt), RecordCount: 1, DispositionFlag: "PRODUCTION" },
      Claim: [{ ID: "SSH-2026-S6", MemberID: members.at(-1)!.memberNo, PayerID: eclaimId.get(S6.patient.payerId)!, ProviderID: FACILITY.id, EmiratesIDNumber: pt.eid, Gross: net, PatientShare: 0, Net: net, Encounter: { FacilityID: FACILITY.id, Type: 2, PatientID: "MRN-S6", Start: eclaimDateTime(at), End: eclaimDateTime(at + 150 * 60_000), StartType: 2, EndType: 1 }, Diagnosis: [{ Type: "Principal", Code: "R10.9" }], Activity: lines.map((l) => ({ ID: l.activityId, Start: eclaimDateTime(at), Type: 3, Code: l.code, Quantity: 1, Net: l.net, Clinician: l.clinician })) }],
    };
    const xml = buildClaimSubmission(sub);
    claimDocs.push({ _id: "clm-S6", claimNo: "SSH-2026-S6", encounterId: eidc, patientId: pt.id, memberId: pt.memberId, payerId: S6.patient.payerId, providerId: S6.providerId, gross: net, patientShare: 0, net, status: "refused", versions: [{ version: 1, lines, xml, sentAt: dubaiIso(sentAt) }], riskScore: null, liveCheckState: "idle", createdAt: dubaiIso(sentAt - 3600_000), evalSet: false, scenario: "S6", ...prov });
    const rat = NOW - S6.remitDaysAgo * DAY;
    const rlines = lines.map((l) => (l.code === S6.denied.code ? { activityId: l.activityId, code: l.code, net: l.net, paymentAmount: 0, denialCode: S6.denied.denialCode, payerComment: S6.denied.payerComment } : { activityId: l.activityId, code: l.code, net: l.net, paymentAmount: l.net }));
    const ra: RemittanceAdvice = { Header: { SenderID: eclaimId.get(S6.patient.payerId)!, ReceiverID: FACILITY.id, TransactionDate: eclaimDateTime(rat), RecordCount: 1, DispositionFlag: "PRODUCTION" }, Claim: [{ ID: "SSH-2026-S6", IDPayer: "FA-CLM-S6", ProviderID: FACILITY.id, PaymentReference: "FALCON-EFT-S6", DateSettlement: eclaimDateTime(rat), Activity: rlines.map((l) => ({ ID: l.activityId, Start: eclaimDateTime(at), Type: 3, Code: l.code, Quantity: 1, Net: l.net, Clinician: licence.get(S6.providerId)!, PaymentAmount: l.paymentAmount, DenialCode: l.denialCode })) }] };
    remitDocs.push({ _id: "clm-S6-ra1", claimId: "clm-S6", claimVersion: 1, payerId: S6.patient.payerId, idPayer: "FA-CLM-S6", paymentReference: "FALCON-EFT-S6", readyAt: dubaiIso(rat), receivedAt: dubaiIso(rat), lines: rlines, xml: buildRemittanceAdvice(ra), ...prov });
    const dl = rlines.find((l) => l.denialCode)!;
    denialDocs.push({ _id: "clm-S6-den2", remittanceId: "clm-S6-ra1", claimId: "clm-S6", activityId: dl.activityId, code: dl.code, denialCode: dl.denialCode, family: "MNEC", amount: dl.net, payerComment: dl.payerComment, deadline: dubaiIso(rat + 60 * DAY), status: "queued", ...prov });
    scenarioIndex.push({ id: "S6", title: S6.title, claimId: "clm-S6", expect: S6.expect });
    scenarioIndex.push({ id: "S7", title: "New insurer pattern (Gulf Shield lipids)", expect: "Gulf Shield refuses lipid panels repeated within 12 months for patients without diabetes (hidden insurer rule, active from 20 Sep 2026). The rule miner should find ≥ 8 refusals in 30 days and propose a rule; once approved the next such order is caught at point of care." });
  }

  const evalEncounterIds = new Set(encounters.filter((e) => e.evalSet).map((e) => e.id));
  const ruleDocs = [
    ...SEED_RULES.map((r) => ({ _id: r.id, payerId: r.payers === "*" ? "*" : r.payers.join(","), scope: "seal", dsl: r, sourceUrl: r.source.url, verified: r.verified, version: r.version, author: "research", approvedBy: "Rania Fakhoury", active: true, ...prov })),
  ];
  const evalSet = { _id: "eval-2026-11", name: "Held-out evaluation set (300 claims, Aug–Nov 2026)", claimIds: Object.keys(evalLabels), labels: evalLabels, createdAt: writtenAt };

  const out = {
    meta: { seedVersion: SEED_VERSION, ruleSetVersion: RULE_SET_VERSION, generatedAt: new Date().toISOString(), asOf: dubaiIso(NOW), params: best.p, templates: templates.length },
    collections: {
      payers,
      plans,
      contracts,
      providers,
      patients,
      members,
      encounters: encDocs,
      orders: orderDocs,
      diagnoses: dxDocs,
      priorAuths: paDocs,
      claims: claimDocs,
      remittances: remitDocs,
      denials: denialDocs,
      outcomes: outcomeDocs,
      rules: ruleDocs,
      evalSets: [evalSet],
      judges: [{ _id: "judges", active: "agentic_llm", shadow: null }],
      scenarios: scenarioIndex,
      // Only the eval set and scenarios' answer keys go to the database (evaluation needs them).
      groundTruth: (gtDocs as { _id: string }[]).filter((g) => g._id.startsWith("enc-S") || evalEncounterIds.has(g._id)),
      settings: [{ _id: "settings", insurerDelaySeconds: 20, killSwitches: {}, modelOverrides: {}, seedVersion: SEED_VERSION }],
    },
  };
  mkdirSync(join(ROOT, "scripts/seed/output"), { recursive: true });
  writeFileSync(join(ROOT, "scripts/seed/output/ground-truth.json.gz"), gzipSync(JSON.stringify(gtDocs)));
  const gz = gzipSync(JSON.stringify(out));
  writeFileSync(join(ROOT, "scripts/seed/output/seed.json.gz"), gz);
  console.log(`wrote seed.json.gz ${(gz.length / 1e6).toFixed(1)} MB; ${xmlChecked} XML documents validated`);
  for (const [k, v] of Object.entries(out.collections)) console.log(`  ${k}: ${(v as unknown[]).length}`);

  writeReport({ m, encounters, history, best, templates, xmlChecked, counts: Object.fromEntries(Object.entries(out.collections).map(([k, v]) => [k, (v as unknown[]).length])), cpt, icd, denialList, licence, sizeMb: gz.length / 1e6 });
}

// ── Report ────────────────────────────────────────────────────────────────
function writeReport(r: {
  m: Metrics;
  encounters: SimEncounter[];
  history: SimEncounter[];
  best: { p: Params; s: number };
  templates: Template[];
  xmlChecked: number;
  counts: Record<string, number>;
  cpt: Map<string, string>;
  icd: Map<string, string>;
  denialList: Map<string, { code: string; description: string; status: string }>;
  licence: Map<string, string>;
  sizeMb: number;
}) {
  const { m } = r;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const ok = (b: boolean) => (b ? "✅ met" : "❌ missed");
  const inR = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;
  const payerRows = PAYERS.map((p) => `| ${p.name} | ${pct(m.refusalRateByPayer[p._id] ?? 0)} | ${ok(inR(m.refusalRateByPayer[p._id] ?? 0, TARGETS.refusalRate))} |`).join("\n");

  // Frequency/window checks straight from the generated history.
  const hba1cRepeats = r.history.filter((e) => e.lines.some((l) => l.code === "83036") && e.gaps.some((g) => g.ruleId === "DAMAN-DM-HBA1C-FREQ"));
  const hba1cRefused = hba1cRepeats.filter((e) => e.remits[0].lines.some((l) => l.code === "83036" && l.denialCode === "MNEC-005"));
  const spineRepeat = r.history.filter((e) => e.gaps.some((g) => g.ruleId === "DAMAN-SPINE-REPEAT-180"));
  const screeningDup = r.history.filter((e) => e.remits[0].lines.some((l) => l.denialCode === "DUPL-002"));
  const s7 = r.history.filter((e) => e.remits[0].lines.some((l) => l.source === "HIDDEN-GS-LIPID-12M"));
  const s7Last30 = s7.filter((e) => e.remits[0].at > dateMs("2026-11-17") - 30 * DAY || e.at > dateMs("2026-11-17") - 30 * DAY);
  const noise = r.history.filter((e) => e.remits[0].lines.some((l) => l.source?.startsWith("noise"))).length;
  const hidden = r.history.filter((e) => e.remits[0].lines.some((l) => l.source?.startsWith("HIDDEN"))).length;
  const sealRuleDenials = r.history.filter((e) => e.remits[0].lines.some((l) => l.source && !l.source.startsWith("noise") && !l.source.startsWith("HIDDEN") && !["eligibility", "filing_deadline"].includes(l.source))).length;
  const codeRows = Object.entries(m.deniedByCode).sort((a, b) => b[1] - a[1]).map(([c, n]) => `| ${c} | ${n} | ${r.denialList.get(c)?.status ?? "?"} | ${r.denialList.get(c)?.description ?? ""} |`).join("\n");
  const themeRows = Object.keys(THEMES).map((t) => {
    const es = r.history.filter((e) => e.theme === t);
    const ref = es.filter((e) => e.remits[0].lines.some((l) => l.denialCode)).length;
    return `| ${t} | ${es.length} | ${pct(ref / Math.max(1, es.length))} | ${r.templates.filter((x) => x.theme === t).length} |`;
  }).join("\n");
  const repairs = r.templates.flatMap((t) => t.icdRepairs ?? []);
  const srcByTheme = new Map<string, Map<string, number>>();
  for (const e of r.history) for (const l of e.remits[0].lines) if (l.denialCode) {
    const mm = srcByTheme.get(e.theme) ?? new Map<string, number>();
    const k = `${l.source} (${l.denialCode})`;
    mm.set(k, (mm.get(k) ?? 0) + 1);
    srcByTheme.set(e.theme, mm);
  }
  const srcRows = [...srcByTheme.entries()].map(([t, mm]) => `| ${t} | ${[...mm.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(" · ")} |`).join("\n");
  const kinds = ["lab", "imaging", "therapy", "procedure", "visit"].map((k) => {
    let n = 0, d = 0;
    for (const e of r.history) e.remits[0].lines.forEach((l, i) => { if (kindOf(e.lines[i].code) === k) { n++; if (l.denialCode) d++; } });
    return `| ${k} | ${n} | ${pct(d / Math.max(1, n))} |`;
  }).join("\n");

  // 20 sample claims for a person to read: mix of refused and paid, across themes.
  const sr = new Rng(7);
  const refusedS = sr.shuffle(r.history.filter((e) => e.remits[0].lines.some((l) => l.denialCode))).slice(0, 12);
  const paidS = sr.shuffle(r.history.filter((e) => !e.remits[0].lines.some((l) => l.denialCode))).slice(0, 8);
  const samples = [...refusedS, ...paidS].map((e, i) => {
    const prov = PROVIDERS.find((p) => p._id === e.providerId)!;
    const lines = e.lines.map((l, j) => {
      const rl = e.remits[0].lines[j];
      return `  - ${l.code} ${r.cpt.get(l.code) ?? ""} ×${l.quantity} — AED ${l.net.toFixed(2)} → ${rl.denialCode ? `**refused ${rl.denialCode}** (${rl.source})` : `paid ${rl.paid.toFixed(2)}`}${l.priorAuth ? ` · PA ${l.priorAuth.authNo} (approved ${l.priorAuth.approvedQty})` : ""}`;
    }).join("\n");
    return `### ${i + 1}. ${e.claimNo} — ${PAYERS.find((p) => p._id === e.patient.payerId)!.name}, ${e.theme}${e.evalSet ? " (eval)" : ""}

- ${new Date(e.at).toISOString().slice(0, 10)} · ${prov.name} (${prov.specialty}) · encounter type ${e.encounterType} · patient ${e.patient.sex}, born ${e.patient.dob.slice(0, 4)}
- Diagnoses: ${e.diagnoses.map((d) => `${d.code}${d.primary ? " (principal)" : ""} ${r.icd.get(d.code) ?? ""}`).join("; ")}
- Complaint: ${e.segments.filter((s) => s.part === "complaint").map((s) => s.text).join(" ")}
- Findings: ${e.segments.filter((s) => s.part === "findings").map((s) => s.text).join(" ")}
- Ground truth gaps: ${e.gaps.length ? e.gaps.map((g) => `${g.ruleId} on ${g.code} (removed: ${g.concepts.join(", ")})`).join("; ") : "none"}${e.injected.length ? ` · injected: ${e.injected.join(", ")}` : ""}
- Lines:
${lines}${e.resubmissions.length ? `\n- Resubmitted (${e.resubmissions[0].type}): ${e.resubmissions[0].comment} → ${e.remits[1]?.lines.map((l) => `${l.code} ${l.denialCode ? "lost" : "recovered"}`).join(", ")}` : ""}`;
  }).join("\n\n");

  const md = `# SEAL synthetic data report

Generated by \`scripts/seed/generate.ts\` (${SEED_VERSION}, rule set ${RULE_SET_VERSION}). Data is **synthetic**: the hospital, insurers, staff and patients are fictional. Note wording comes from MTSamples (CC0) rewritten by an LLM into ${r.templates.length} Dubai encounter templates; every rule, rate and denial code traces to \`/research\` or is listed as an assumption below.

## Calibration targets (plan §11)

Measured on the ${r.history.length.toLocaleString()} history claims (eval set excluded). Calibrated parameters: \`${JSON.stringify(r.best.p)}\`.

| Target | Goal | Result | Status |
|---|---|---|---|
| First-pass refusal rate (all) | 12%–18% | ${pct(m.refusalRate)} | ${ok(inR(m.refusalRate, TARGETS.refusalRate))} |
| Share of refused value from MNEC codes | 45%–50% | ${pct(m.mnecValueShare)} | ${ok(inR(m.mnecValueShare, TARGETS.mnecValueShare))} |
| Lab line refusal rate vs other lines | ≥ 3× | ${pct(m.labLineRate)} vs ${pct(m.otherLineRate)} = **${m.labRatio.toFixed(1)}×** | ${ok(m.labRatio >= TARGETS.labRatio)} |
| Tests per diabetes encounter | 2–12, skewed low | min ${m.diabetesTests.min}, median ${m.diabetesTests.median}, mean ${m.diabetesTests.mean.toFixed(1)}, max ${m.diabetesTests.max} | ${ok(m.diabetesTests.min >= 2 && m.diabetesTests.max <= 12 && m.diabetesTests.median < 7)} |
| HbA1c every 3 months | repeat < 90 d refused unless documented | ${hba1cRepeats.length} undocumented early repeats, ${hba1cRefused.length} refused MNEC-005 | ${ok(hba1cRepeats.length > 0 && hba1cRefused.length / Math.max(1, hba1cRepeats.length) > 0.7)} |
| Spine MRI repeat within 180 days | refused without new deficit | ${spineRepeat.length} cases injected | ${ok(spineRepeat.length > 0)} |
| Same screening test within 90 days | refused | ${screeningDup.length} DUPL-002 refusals | ${ok(screeningDup.length > 0)} |
| S7 Gulf Shield lipid pattern | ≥ 8 refusals in the last 30 days | ${s7.length} total, ${s7Last30.length} in the last 30 days | ${ok(s7Last30.length >= 8)} |

### First-pass refusal rate by insurer

| Insurer | Rate | Target 12–18% |
|---|---|---|
${payerRows}

Diabetes tests per encounter: ${Object.entries(m.diabetesTests.hist).map(([k, v]) => `${k}: ${v}`).join(" · ")}

### Refusal rate by line type

| Line type | Lines | Refused |
|---|---|---|
${kinds}

### Where refusals come from

- SEAL's public rules (applied by the insurer with ~88–96% enforcement): ${sealRuleDenials} claims
- Insurer hidden rules not in SEAL's rule set: ${hidden} claims
- Noise (administrative and false clinical denials): ${noise} claims

So SEAL has to *predict*: the insurer skips some rule hits, applies rules SEAL does not know, and adds noise (plan §11).

### Refusals by denial code (first pass, lines)

| Code | Lines | R2 status | Description |
|---|---|---|---|
${codeRows}

### Refused lines by source and theme (first pass)

Sources are the mock insurer's reasons: a SEAL rule id, a hidden insurer rule, eligibility/filing checks, or noise. They are ground truth for the report only and are not loaded into the database.

| Theme | Sources |
|---|---|
${srcRows}

### Encounters by theme

| Theme | History claims | First-pass refusal | Templates |
|---|---|---|---|
${themeRows}

## Validation

- ${r.xmlChecked.toLocaleString()} XML documents (every claim's first submission and first remittance) built and validated against the R1 field rules.
- Every denial code used is in research/R2/denial_codes.json (generation fails otherwise).
- Template ICD codes: all billable FY2027; ${repairs.length} non-billable parents mapped to a billable child (${repairs.join(", ") || "none"}).
- Output: \`scripts/seed/output/seed.json.gz\`, ${r.sizeMb.toFixed(1)} MB.

| Collection | Documents |
|---|---|
${Object.entries(r.counts).map(([k, v]) => `| ${k} | ${v.toLocaleString()} |`).join("\n")}

## Assumptions (no source — also shown on /admin)

| Item | Value | Why |
|---|---|---|
${ASSUMPTIONS.map((a) => `| ${a.key} | ${a.value} | ${a.why} |`).join("\n")}
| denial deadline | 60 days from the remittance | Dubai directive caps resubmissions at 2 but no window was found |
| filing deadline | 90 days from the encounter | Not found for Dubai |

## 20 sample claims

${samples}
`;
  writeFileSync(join(ROOT, "research/data-report.md"), md);
  console.log("wrote research/data-report.md");
  console.log(JSON.stringify({ refusal: m.refusalRate, byPayer: m.refusalRateByPayer, mnec: m.mnecValueShare, labRatio: m.labRatio, dm: m.diabetesTests, s7: s7.length, s7Last30: s7Last30.length }, null, 1));
}

main();
