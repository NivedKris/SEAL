import { NextResponse } from "next/server";
import { TENANT_COOKIE, isTenant } from "@/lib/tenant";

/** Sign in to a hospital: /t/basic or /t/apollo. Sets the hospital and opens Today. */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const id = isTenant(tenant) ? tenant : "basic";
  const res = NextResponse.redirect(new URL("/today", req.url));
  res.cookies.set(TENANT_COOKIE, id, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
