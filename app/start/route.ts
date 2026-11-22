import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { TENANT_COOKIE, isTenant } from "@/lib/tenant";

/** Where the installed app opens: the hospital's Today screen, or the hospital picker the first time. */
export async function GET(req: Request) {
  const t = (await cookies()).get(TENANT_COOKIE)?.value;
  return NextResponse.redirect(new URL(t && isTenant(t) ? "/today" : "/select", req.url));
}
