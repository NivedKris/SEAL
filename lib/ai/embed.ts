import { Binary } from "mongodb";
import { EMBEDDING } from "@/config/models";
import { maskIdentifiers } from "./mask";

/**
 * Embeddings for the outcome ledger (similar-claim memory, plan §10).
 * Runs locally with transformers.js (ONNX, CPU): no API key, no quota, no data leaves the server.
 * Model weights (~34 MB quantized) download once from the Hugging Face hub and are cached.
 * Vectors are stored as BSON float32 to stay inside the Atlas free-tier storage budget.
 */
type Extractor = (texts: string[], opts: { pooling: "cls" | "mean"; normalize: boolean }) => Promise<{ tolist(): number[][]; dispose(): void }>;
let extractor: Promise<Extractor> | null = null;

function load(): Promise<Extractor> {
  return (extractor ??= (async () => {
    const t = await import("@huggingface/transformers");
    // Only /tmp is writable on Vercel.
    t.env.cacheDir = process.env.VERCEL ? "/tmp/hf-cache" : ".cache/hf";
    return (await t.pipeline("feature-extraction", EMBEDDING.model, { dtype: EMBEDDING.dtype })) as unknown as Extractor;
  })());
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const run = await load();
  const tensor = await run(texts.map(maskIdentifiers), { pooling: EMBEDDING.pooling, normalize: true });
  const out = tensor.tolist();
  tensor.dispose(); // native memory isn't freed by GC; without this a long run gets OOM-killed
  if (out.length !== texts.length || out[0].length !== EMBEDDING.dims) throw new Error(`embedding shape mismatch: ${out.length}×${out[0]?.length}`);
  return out;
}

/** Normalised float32 BSON vector (cosine similarity in Atlas Vector Search). */
export function toVector(values: number[]): Binary {
  const n = Math.hypot(...values) || 1;
  return Binary.fromFloat32Array(new Float32Array(values.map((v) => v / n)));
}
