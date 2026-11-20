import { getNewTransactions } from "@/lib/mock/dhpo";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** MOCK DHPO GetNewTransactions?receiver=<facility or payer id>. Runs the insurer on files past their ready time. */
export async function GET(req: Request) {
  const receiver = new URL(req.url).searchParams.get("receiver");
  if (!receiver) return Response.json({ error: "receiver is required" }, { status: 400 });
  return Response.json({ transactions: await getNewTransactions(receiver) });
}
