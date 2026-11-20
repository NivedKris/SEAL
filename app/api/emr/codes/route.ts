import { searchCpt, searchIcd } from "@/lib/codes";

export const dynamic = "force-dynamic";

/** Code search for the EMR pickers: ?type=cpt|icd&q=…&patterns=M85.8*,E55* */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = u.searchParams.get("q") ?? "";
  if (u.searchParams.get("type") === "icd") return Response.json({ codes: searchIcd(q, (u.searchParams.get("patterns") ?? "").split(",").filter(Boolean)) });
  return Response.json({ codes: searchCpt(q) });
}
