import "server-only";
import { z } from "zod";

const schema = z.object({
  GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is not set"),
  /** Plan names it GEMINI_API_KEY; GOOGLE_API_KEY is accepted too. */
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY (or GOOGLE_API_KEY) is not set"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is not set"),
  MONGODB_DB: z.string().default("seal"),
  APP_BASE_URL: z.string().optional(),
});
type Env = z.infer<typeof schema>;

let cached: Env | null = null;
function load(): Env {
  cached ??= schema.parse({ ...process.env, GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY });
  return cached;
}

/**
 * Environment variables, read and validated on first use — not at import — so `next build` on
 * Vercel never needs the keys, and a missing key gives a clear error on the first request.
 * Locally they come from .env; on Vercel from Project → Settings → Environment Variables.
 */
export const env = new Proxy({} as Env, { get: (_t, key: string) => load()[key as keyof Env] });
