import { ClaimDetail } from "@/components/billing/claim-detail";

export const metadata = { title: "Claim" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClaimDetail id={id} />;
}
