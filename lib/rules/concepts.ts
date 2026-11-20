import type { DocConcept } from "./dsl";

/** Plain-language meaning of each documentation concept (shown on risk cards and given to the models). */
export const CONCEPT_TEXT: Record<DocConcept, string> = {
  symptom_duration: "How long the symptom has been present (e.g. '6 weeks').",
  conservative_treatment_failed: "Conservative treatment already tried (physiotherapy, analgesics, rest) and that it did not help, with its duration.",
  neurologic_deficit: "An objective neurologic finding on examination (weakness, reflex change, sensory loss, positive straight-leg raise).",
  new_or_progressive_deficit: "A neurologic deficit that is new or worse since the previous scan.",
  red_flag_symptom: "A red-flag feature (fever, weight loss, night pain, bladder or bowel change, saddle numbness, cancer history, trauma).",
  signs_or_symptoms_present: "Symptoms or signs that prompted the test (not a routine screen).",
  qualifying_diagnosis_documented: "A condition that qualifies the patient for the test (for vitamin D: osteoporosis, rickets, kidney disease, malabsorption).",
  reason_for_repeat_test: "Why the test is being repeated earlier than the usual interval (e.g. a medication change or poor control).",
  medication_change: "A recent change in medication that the test is monitoring.",
  neuro_manifestations: "Symptoms or signs of neuropathy (numbness, tingling, reduced sensation in the feet).",
  pain_score_baseline: "A baseline pain score (e.g. 7/10).",
  pain_score_improvement: "Improvement in the pain score since treatment began.",
  significant_change_in_condition: "A significant change in the patient's condition since the last assessment.",
  previous_investigation_inconclusive: "A previous investigation that was inconclusive.",
};
