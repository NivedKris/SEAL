import { uploadTransaction } from "@/lib/mock/dhpo";

export const dynamic = "force-dynamic";

/** MOCK DHPO UploadTransaction. Body: the Claim.Submission XML (text/xml). */
export async function POST(req: Request) {
  const r = await uploadTransaction(await req.text());
  return Response.json(r, { status: r.result === 0 ? 200 : 400 });
}
