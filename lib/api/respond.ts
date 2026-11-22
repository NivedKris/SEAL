import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Run a handler and turn thrown errors into JSON (400 for invalid input, 404 for missing, else 500). */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  const t0 = performance.now();
  try {
    const res = NextResponse.json(await fn());
    // How long the server spent, visible in the browser's network panel and in scripts/perf.sh.
    res.headers.set("Server-Timing", `app;dur=${(performance.now() - t0).toFixed(0)}`);
    return res;
  } catch (e) {
    const msg = e instanceof ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (e as Error).message;
    const status = e instanceof ZodError || e instanceof BadRequest ? 400 : /not found/i.test(msg) ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export class BadRequest extends Error {}

/** Until sign-in exists (POC), actions are attributed to the role named in the request. */
export function actorFrom(req: Request, fallback: string) {
  return { kind: "user" as const, id: req.headers.get("x-seal-user") ?? fallback };
}
