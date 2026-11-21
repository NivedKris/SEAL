import "server-only";
import { cookies } from "next/headers";
import { TENANTS, TENANT_COOKIE, isTenant, type Tenant } from "./tenant";

/** The hospital for this request (from the sign-in cookie). Outside a request (scripts): Basic. */
export async function currentTenant(): Promise<Tenant> {
  try {
    const v = (await cookies()).get(TENANT_COOKIE)?.value;
    return TENANTS[isTenant(v) ? v : "basic"];
  } catch {
    return TENANTS.basic;
  }
}
