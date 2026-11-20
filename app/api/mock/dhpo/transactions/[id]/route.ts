import { downloadTransactionFile, setTransactionDownloaded } from "@/lib/mock/dhpo";

export const dynamic = "force-dynamic";

/** MOCK DHPO DownloadTransactionFile?receiver=… */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receiver = new URL(req.url).searchParams.get("receiver") ?? "";
  const xml = await downloadTransactionFile(id, receiver);
  return xml ? new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8" } }) : Response.json({ error: "not found" }, { status: 404 });
}

/** MOCK DHPO SetTransactionDownloaded?receiver=… */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receiver = new URL(req.url).searchParams.get("receiver") ?? "";
  return Response.json({ result: (await setTransactionDownloaded(id, receiver)) ? 0 : -1 });
}
