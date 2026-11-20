import type { DocConcept } from "@/lib/rules/dsl";

/**
 * MOCK INSURER — medical records review. Part of the simulated insurer, logically outside SEAL;
 * SEAL's agents and rule engine never import lib/mock.
 *
 * The insurer's reviewer reads the records the hospital sends (note, addendum, appeal letter)
 * with fixed keyword patterns. It is deliberately cruder than SEAL's AI checker and reads the
 * text differently, so SEAL has to predict rather than mirror the insurer.
 */

const NEG = /\b(no|denies|denied|without|negative for|not|nil|absent)\b[^.;]{0,25}$/i;

/** True if the pattern matches somewhere not preceded by a negation in the same clause. */
function affirmed(text: string, re: RegExp): boolean {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const m of text.matchAll(g)) {
    const before = text.slice(Math.max(0, m.index! - 40), m.index!);
    if (!NEG.test(before)) return true;
  }
  return false;
}

const PATTERNS: Record<DocConcept, (t: string) => boolean> = {
  symptom_duration: (t) =>
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|several|few)\s*[- ]?(day|week|month|year)s?\b/i.test(t) || /\b(since|for the (past|last))\s+\w+/i.test(t),
  conservative_treatment_failed: (t) =>
    /(physio|physical therapy|nsaid|analgesi|ibuprofen|diclofenac|paracetamol|naproxen|conservative|home exercise|rest|bracing|injection)[^.]{0,80}(fail|no (relief|improvement|benefit)|without (relief|improvement)|did not (help|improve)|not (helped|improved)|persist|ineffective)/i.test(t) ||
    /(fail|no relief|no improvement)[^.]{0,40}(physio|physical therapy|nsaid|analgesi|conservative|medication)/i.test(t),
  neurologic_deficit: (t) =>
    affirmed(t, /(weakness|numbness|paraesthesia|paresthesia|tingling|hyporeflexia|areflexia|foot drop|sensory loss|radiculopathy|sciatica)/i) ||
    /(reduced|diminished|absent|depressed|decreased)[^.;]{0,25}(reflex|sensation)/i.test(t) ||
    /(straight[- ]leg[- ]rais\w*|\bslr\b)[^.;]{0,20}positive|positive[^.;]{0,12}(straight[- ]leg|\bslr\b)/i.test(t) ||
    /\bpower [0-4](\+|-)?\s*\/\s*5\b/i.test(t),
  new_or_progressive_deficit: (t) => /(new|progressive|progressing|worsening|increasing)[^.]{0,30}(weakness|numbness|deficit|foot drop|sensory loss)/i.test(t),
  red_flag_symptom: (t) => affirmed(t, /(fever|weight loss|night pain|incontinence|saddle (an)?aesthesia|urinary retention|history of (cancer|malignancy)|trauma|fall from)/i),
  signs_or_symptoms_present: (t) =>
    affirmed(t, /(pain|tender|fatigue|tired|polyuria|polydipsia|swelling|fever|dizz|palpitation|shortness of breath|breathless|cough|rash|bleeding|weight (gain|loss)|bruis|pallor|hair loss|cold intolerance|chest tightness)/i),
  qualifying_diagnosis_documented: (t) =>
    affirmed(t, /(osteopor|osteopen|rickets|osteomalacia|chronic kidney|ckd|renal (failure|insufficiency|disease)|malabsorp|coeliac|celiac|crohn|bariatric|vitamin d deficien|hyperparathyroid|diabet|hypothyroid|hyperthyroid|anaemia|anemia|dyslipid|hyperlipid)/i),
  reason_for_repeat_test: (t) =>
    /(repeat|recheck|re-check|repeated|again)[^.]{0,80}(because|due to|after|since|following|to assess|to monitor|change|adjust|abnormal|poor(ly)? control|uncontrolled|high|raised|elevated)/i.test(t) ||
    /(dose|medication|treatment|therapy|insulin|metformin)[^.]{0,20}(change|changed|adjust|adjusted|increase|increased|started|added|switched)/i.test(t),
  medication_change: (t) =>
    /(start|started|starting|increase|increased|adjust|adjusted|switch|switched|change|changed|add|added|stop|stopped|titrat)[^.]{0,30}(dose|metformin|insulin|gliclazide|sitagliptin|empagliflozin|statin|atorvastatin|rosuvastatin|levothyroxine|medication|therapy|\d+\s?mg)/i.test(t),
  neuro_manifestations: (t) => affirmed(t, /(neuropath|numbness|tingling|burning feet|paraesthesia|paresthesia|reduced (monofilament|vibration)|loss of (sensation|vibration))/i),
  pain_score_baseline: (t) => /(pain score|\bvas\b|\bnrs\b|\b\d{1,2}\s*\/\s*10\b|\b\d{1,2} out of 10\b)/i.test(t),
  pain_score_improvement: (t) => /(improv|reduc|decreas|better)[^.]{0,40}(pain|score|\/10|out of 10)/i.test(t) || /\b\d{1,2}\s*\/\s*10\b[^.]{0,30}(to|now)\s*\d{1,2}\s*\/\s*10/i.test(t),
  significant_change_in_condition: (t) => /(worsen|deteriorat|significant change|new symptom|progress(ed|ion)|acute change|flare)/i.test(t),
  previous_investigation_inconclusive: (t) =>
    /(inconclusive|non-?diagnostic|equivocal|indeterminate|unremarkable|normal)[^.]{0,40}(x-?ray|radiograph|ultrasound|\bct\b|\bmri\b|scan|test)/i.test(t) ||
    /(x-?ray|radiograph|ultrasound|\bct\b|\bmri\b|scan)[^.]{0,40}(inconclusive|non-?diagnostic|equivocal|indeterminate|did not (show|explain))/i.test(t),
};

/** Concept reader over the records text: always a definite true/false (the insurer does not wait). */
export function reviewRecords(text: string): (c: DocConcept) => boolean {
  const cache = new Map<DocConcept, boolean>();
  return (c) => {
    if (!cache.has(c)) cache.set(c, PATTERNS[c](text));
    return cache.get(c)!;
  };
}
