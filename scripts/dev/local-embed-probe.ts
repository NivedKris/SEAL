/** Dev check: local embedding speed and a similarity sanity check. */
import { embedTexts } from "@/lib/ai/embed";

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
async function main() {
  let t = Date.now();
  const [a, b, c] = await embedTexts([
    "Falcon Health refused HbA1c repeated within 3 months for type 2 diabetes, MNEC-004",
    "Glycated haemoglobin test denied: too soon after the previous one, diabetic patient",
    "MRI lumbar spine refused, prior authorization missing",
  ]);
  console.log(`first call (incl. model load) ${Date.now() - t} ms, dims ${a.length}`);
  console.log(`similar pair ${dot(a, b).toFixed(3)} · unrelated pair ${dot(a, c).toFixed(3)}`);
  const batch = Array.from({ length: 100 }, (_, i) => `Outcome ${i}: claim line 83036 refused by payer for medical necessity, documentation lacked indication`);
  t = Date.now();
  await embedTexts(batch);
  console.log(`100 texts ${Date.now() - t} ms`);
}
main();
