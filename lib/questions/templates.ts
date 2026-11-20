import type { DocConcept } from "@/lib/rules/dsl";
import type { QuestionDoc } from "@/lib/db/schemas";

type Field = QuestionDoc["fields"][number];

/**
 * Built-in structured fields per documentation concept (English and Arabic). Used when the
 * question composer model is unavailable, and as the shape the model's fields are checked against.
 */
export const CONCEPT_FIELDS: Record<DocConcept, Field[]> = {
  symptom_duration: [
    { key: "duration_value", kind: "number", labelEn: "How long has it been present?", labelAr: "منذ متى بدأت الأعراض؟" },
    { key: "duration_unit", kind: "choice", labelEn: "Unit", labelAr: "الوحدة", options: ["days", "weeks", "months", "years"] },
  ],
  conservative_treatment_failed: [
    { key: "treatment", kind: "text", labelEn: "Treatment already tried, and for how long", labelAr: "العلاج الذي جُرّب ومدته" },
    { key: "treatment_outcome", kind: "choice", labelEn: "Result", labelAr: "النتيجة", options: ["no improvement", "partial improvement", "improved"] },
  ],
  neurologic_deficit: [{ key: "neuro_finding", kind: "text", labelEn: "Neurologic finding on examination (power, reflexes, sensation, SLR) — or 'none'", labelAr: "الموجودات العصبية عند الفحص (القوة، المنعكسات، الإحساس) أو «لا يوجد»" }],
  new_or_progressive_deficit: [{ key: "new_deficit", kind: "text", labelEn: "What is new or worse since the previous scan?", labelAr: "ما الجديد أو الأسوأ منذ التصوير السابق؟" }],
  red_flag_symptom: [
    { key: "red_flag", kind: "choice", labelEn: "Red-flag feature present", labelAr: "علامة إنذار موجودة", options: ["none", "fever", "weight loss", "night pain", "bladder or bowel change", "saddle numbness", "cancer history", "trauma"] },
  ],
  signs_or_symptoms_present: [{ key: "symptoms", kind: "text", labelEn: "Symptoms or signs that prompted this test", labelAr: "الأعراض أو العلامات التي استدعت هذا الفحص" }],
  qualifying_diagnosis_documented: [{ key: "indication", kind: "text", labelEn: "Condition or medicine that is the reason for this test", labelAr: "الحالة أو الدواء الذي يستدعي هذا الفحص" }],
  reason_for_repeat_test: [{ key: "repeat_reason", kind: "text", labelEn: "Why repeat it now (e.g. dose changed on a date)?", labelAr: "لماذا يُعاد الفحص الآن؟ (مثل تغيير الجرعة)" }],
  medication_change: [
    { key: "medication", kind: "text", labelEn: "Medication started or changed", labelAr: "الدواء الذي بدأ أو تغيّر" },
    { key: "change_date", kind: "date", labelEn: "Date of the change", labelAr: "تاريخ التغيير" },
  ],
  neuro_manifestations: [{ key: "neuropathy", kind: "text", labelEn: "Neuropathy symptoms or signs (numbness, tingling, reduced sensation)", labelAr: "أعراض أو علامات اعتلال الأعصاب (خدر، تنميل، ضعف الإحساس)" }],
  pain_score_baseline: [{ key: "pain_baseline", kind: "number", labelEn: "Pain score before treatment (0–10)", labelAr: "درجة الألم قبل العلاج (0–10)", unit: "/10" }],
  pain_score_improvement: [{ key: "pain_now", kind: "number", labelEn: "Pain score now (0–10)", labelAr: "درجة الألم الآن (0–10)", unit: "/10" }],
  significant_change_in_condition: [{ key: "change", kind: "text", labelEn: "What changed in the patient's condition?", labelAr: "ما الذي تغيّر في حالة المريض؟" }],
  previous_investigation_inconclusive: [{ key: "previous_test", kind: "text", labelEn: "Earlier investigation and why it was inconclusive", labelAr: "الفحص السابق ولماذا لم يكن حاسماً" }],
};

/** Short question phrases per concept, joined into one question per order. */
const ASK: Record<DocConcept, [string, string]> = {
  symptom_duration: ["how long it has been present", "منذ متى بدأت الأعراض"],
  conservative_treatment_failed: ["what treatment was already tried and whether it helped", "ما العلاج الذي جُرّب وهل أفاد"],
  neurologic_deficit: ["what neurologic finding you found on examination", "ما الموجودات العصبية التي وجدتها عند الفحص"],
  new_or_progressive_deficit: ["what is new or worse since the previous scan", "ما الجديد أو الأسوأ منذ التصوير السابق"],
  red_flag_symptom: ["whether any red-flag feature is present", "هل توجد أي علامة إنذار"],
  signs_or_symptoms_present: ["which symptoms or signs prompted the test", "ما الأعراض أو العلامات التي استدعت الفحص"],
  qualifying_diagnosis_documented: ["which condition or medicine is the reason for the test", "ما الحالة أو الدواء الذي يستدعي الفحص"],
  reason_for_repeat_test: ["why it is repeated now", "لماذا يُعاد الآن"],
  medication_change: ["which medication changed, and when", "أي دواء تغيّر ومتى"],
  neuro_manifestations: ["which neuropathy symptoms or signs are present", "ما أعراض أو علامات اعتلال الأعصاب الموجودة"],
  pain_score_baseline: ["the pain score before treatment", "درجة الألم قبل العلاج"],
  pain_score_improvement: ["the pain score now", "درجة الألم الآن"],
  significant_change_in_condition: ["what changed in the patient's condition", "ما الذي تغيّر في حالة المريض"],
  previous_investigation_inconclusive: ["which earlier investigation was inconclusive", "أي فحص سابق لم يكن حاسماً"],
};

export function templateQuestion(order: string, concepts: DocConcept[]): Pick<QuestionDoc, "textEn" | "textAr" | "fields"> {
  const fields = concepts.flatMap((c) => CONCEPT_FIELDS[c]);
  const en = concepts.map((c) => ASK[c][0]);
  const ar = concepts.map((c) => ASK[c][1]);
  const join = (xs: string[], and: string) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} ${and} ${xs.at(-1)}` : xs[0]);
  return {
    textEn: `For ${order}, please record ${join(en, "and")}.`,
    textAr: `بخصوص ${order}، يرجى تسجيل ${join(ar, "و")}.`,
    fields,
  };
}
