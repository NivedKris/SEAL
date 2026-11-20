/**
 * Seed step 2 (plan §11): build encounter templates from MTSamples with the LLM.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed/build-templates.ts <mtsamples.jsonl> [perTheme=8]
 *
 * Input: JSONL rows {id, specialty, text} from the Argilla copy of MTSamples (CC0).
 * Output (committed): scripts/seed/data/mtsamples-selected.jsonl and scripts/seed/data/templates.json.
 * Re-running keeps templates already built (cache by source id).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { z } from "zod";
import { callJson, setCallSink } from "@/lib/ai/router";
import { DocConcept } from "@/lib/rules/dsl";
import { THEMES, type Theme } from "./world";

const ROOT = join(__dirname, "../..");
const DATA = join(ROOT, "scripts/seed/data");
mkdirSync(DATA, { recursive: true });

/** Orders a template may contain, per theme (from the R5 CPT subset). */
export const THEME_ORDERS: Record<Theme, string[]> = {
  low_back_pain: ["72100", "72148", "72149", "72158", "72131", "97161", "85025", "86140", "85651"],
  neck_pain: ["72141", "72156", "97161", "85025"],
  knee_pain: ["73560", "73721", "20610", "20611", "97161"],
  shoulder_pain: ["73221", "20610", "20611", "97161"],
  tendinopathy: ["0101T", "0102T", "28890", "20610", "97161"],
  diabetes_followup: ["83036", "80061", "82043", "82570", "82565", "80053", "80048", "85025", "84443", "82607", "82306", "84681", "83525", "80076", "81001", "82947"],
  hypertension_lipids: ["80061", "80048", "82565", "84443", "85025", "81001", "93000", "82947", "83036"],
  general_checkup: ["80061", "83036", "82947", "85025", "80053", "84443", "82306", "81001", "86803", "87340"],
  fatigue_anaemia: ["85025", "82728", "83540", "82607", "84443", "82306", "80053"],
  thyroid: ["84443", "85025", "80053", "82306"],
  osteoporosis: ["82306", "80053", "82652", "84443"],
  abdominal_pain_er: ["74176", "74177", "74178", "85025", "80053", "81001", "76705", "86140"],
  injury_er: ["72100", "73560", "72131", "96372"],
  palpitations: ["93000", "93224", "84443", "80048", "85025"],
  physio_course: ["97110", "97112", "97140", "97530", "97162", "97161"],
};

const Segment = z.object({ text: z.string().min(5), concepts: z.array(DocConcept) });
export const TemplateOut = z.object({
  summary: z.string(),
  complaintSegments: z.array(Segment).min(2).max(6),
  findingSegments: z.array(Segment).min(1).max(6),
  plan: z.string(),
  diagnoses: z.array(z.object({ icd10: z.string(), primary: z.boolean() })).min(1).max(4),
  orders: z.array(z.object({ code: z.string(), reason: z.string() })).min(1).max(16),
  ageRange: z.tuple([z.number().int().min(0), z.number().int().max(100)]),
  sex: z.enum(["M", "F", "any"]),
});
export type TemplateOut = z.infer<typeof TemplateOut>;
export type Template = TemplateOut & { icdRepairs?: string[]; id: string; theme: Theme; sourceId: string; sourceSpecialty: string; promptVersion: string; model: string };

const PROMPT_VERSION = "seed-template-builder/v1";

async function main() {
  const [input, perThemeArg] = process.argv.slice(2);
  if (!input) throw new Error("usage: build-templates.ts <mtsamples.jsonl> [perTheme]");
  const perTheme = Number(perThemeArg ?? 8);
  const rows = readFileSync(input, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { id: string; specialty: string; text: string });
  const icd = new Map(
    (JSON.parse(gunzipSync(readFileSync(join(ROOT, "research/R5/codes/icd10cm_2027_full.json.gz"))).toString()) as { codes: { code: string; description: string }[] }).codes.map((c) => [c.code, c.description]),
  );
  const cptLabels = new Map((JSON.parse(readFileSync(join(ROOT, "research/R5/codes/cpt_seal_subset.json"), "utf8")) as { codes: { code: string; label: string }[] }).codes.map((c) => [c.code, c.label]));
  const system = readFileSync(join(ROOT, "prompts/seed-template-builder/v1.md"), "utf8");

  // Select sources per theme: right specialty, most keyword hits, length 800–6000 chars, no reuse.
  const used = new Set<string>();
  const selected: { theme: Theme; row: (typeof rows)[number] }[] = [];
  for (const [theme, t] of Object.entries(THEMES) as [Theme, (typeof THEMES)[Theme]][]) {
    const scored = rows
      .filter((r) => (t.mts.spec as readonly string[]).includes(r.specialty) && r.text.length > 800 && r.text.length < 6000 && !used.has(r.id))
      .map((r) => ({ r, s: t.mts.kw.reduce((n, k) => n + (r.text.toLowerCase().split(k).length - 1), 0) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.r.id.localeCompare(b.r.id))
      .slice(0, perTheme);
    for (const { r } of scored) {
      used.add(r.id);
      selected.push({ theme, row: r });
    }
    console.log(`${theme}: ${scored.length} sources`);
  }
  writeFileSync(join(DATA, "mtsamples-selected.jsonl"), selected.map((s) => JSON.stringify({ theme: s.theme, ...s.row })).join("\n") + "\n");

  const outFile = join(DATA, "templates.json");
  const templates: Template[] = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : [];
  const done = new Set(templates.map((t) => t.sourceId));
  const logFile = join(DATA, "template-ai-calls.jsonl");
  setCallSink((c) => appendFileSync(logFile, JSON.stringify(c) + "\n"));

  // Billable-code repair: a non-billable parent (e.g. "K35.3") becomes its "unspecified" billable
  // child when one exists, else its first child. Repairs are recorded on the template.
  const icdCodes = [...icd.keys()];
  const repairCode = (raw: string): { code: string; repaired?: string } | null => {
    const c = raw.toUpperCase().trim();
    if (icd.has(c)) return { code: c };
    const kids = icdCodes.filter((k) => k.startsWith(c) && k.length > c.length);
    if (!kids.length) return null;
    const unspecified = kids.find((k) => /unspecified/i.test(icd.get(k) ?? ""));
    return { code: unspecified ?? kids[0], repaired: c };
  };
  const Checked = TemplateOut.superRefine((t, ctx) => {
    if (t.diagnoses.filter((d) => d.primary).length !== 1) ctx.addIssue({ code: "custom", path: ["diagnoses"], message: "exactly one primary diagnosis" });
  });
  const schemaText = JSON.stringify(z.toJSONSchema(TemplateOut));

  const todo = selected.filter((s) => !done.has(s.row.id));
  console.log(`${templates.length} cached, ${todo.length} to build`);
  let ok = 0;
  let failed = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // One lane per Groq model: each model has its own 8,000 tokens-per-minute limit on this account.
  // Gemini is not used here (quota exhausted on this key at build time).
  const lane = async (model: string) => {
    while (todo.length) {
      const { theme, row } = todo.shift()!;
      const allowed = THEME_ORDERS[theme].map((c) => `${c} ${cptLabels.get(c) ?? ""}`).join("\n");
      const user = `Theme: ${theme}\nAllowed order codes (CPT):\n${allowed}\n\nJSON schema of the answer:\n${schemaText}\n\nSource transcription (${row.specialty}):\n${row.text.slice(0, 3500)}`;
      for (let tries = 0; tries < 6; tries++) {
        try {
          const { data, call } = await callJson({
            agent: "seedTemplateBuilder",
            promptVersion: PROMPT_VERSION,
            system,
            user,
            schema: Checked,
            config: { groqModel: model, geminiModels: [], maxTokens: 2800, timeoutMs: 90000 },
          });
          const orders = data.orders.filter((o) => THEME_ORDERS[theme].includes(o.code)).slice(0, 8);
          if (!orders.length) throw new Error("no allowed orders");
          const repairs: string[] = [];
          const diagnoses = data.diagnoses.flatMap((d) => {
            const r = repairCode(d.icd10);
            if (!r) return [];
            if (r.repaired) repairs.push(`${r.repaired}→${r.code}`);
            return [{ ...d, icd10: r.code }];
          });
          if (diagnoses.filter((d) => d.primary).length !== 1) throw new Error(`no valid primary diagnosis (${data.diagnoses.map((d) => d.icd10).join(",")})`);
          templates.push({ ...data, diagnoses, orders, icdRepairs: repairs, id: `tpl-${theme}-${row.id.slice(0, 8)}`, theme, sourceId: row.id, sourceSpecialty: row.specialty, promptVersion: PROMPT_VERSION, model: call.model });
          writeFileSync(outFile, JSON.stringify(templates, null, 1));
          ok++;
          process.stdout.write(`.`);
          break;
        } catch (e) {
          const msg = (e as Error).message;
          const wait = msg.match(/try again in ([\d.]+)s/);
          if (/Rate limit|429/.test(msg) && tries < 5) {
            await sleep((wait ? Number(wait[1]) : 20) * 1000 + 1500);
            continue;
          }
          failed++;
          console.log(`\n  ✗ ${model} ${theme} ${row.id.slice(0, 8)}: ${msg.slice(0, 200)}`);
          break;
        }
      }
    }
  };
  await Promise.all(["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"].map(lane));
  console.log(`\nbuilt ${ok}, failed ${failed}, total ${templates.length}`);
}

main();
