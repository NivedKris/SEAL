import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { GoogleGenAI } from "@google/genai";
import { db } from "@/lib/db/mongo";
import { env } from "@/lib/env";
import { GROQ, GEMINI } from "@/config/models";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function timed<T>(fn: () => Promise<T>) {
  const t = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - t };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: (e as Error).message.slice(0, 200) };
  }
}

/** Connectivity check for the three external services. */
export async function GET() {
  const [mongo, groq, gemini] = await Promise.all([
    timed(async () => (await db()).command({ ping: 1 })),
    timed(async () => {
      const ids = new Set((await new Groq({ apiKey: env.GROQ_API_KEY }).models.list()).data.map((m) => m.id));
      const missing = Object.values(GROQ).filter((m) => !ids.has(m));
      if (missing.length) throw new Error(`Groq models missing: ${missing.join(", ")}`);
    }),
    timed(() => new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }).models.get({ model: GEMINI.fallback[0] })),
  ]);
  const ok = mongo.ok && groq.ok && gemini.ok;
  return NextResponse.json({ ok, mongo, groq, gemini }, { status: ok ? 200 : 503 });
}
