import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Run a handler and turn thrown errors into JSON (400 for invalid input, 404 for missing, else 500). */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn());
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
