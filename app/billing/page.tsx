import { Suspense } from "react";
import { BillingQueues } from "@/components/billing/queues";

export const metadata = { title: "Billing" };

export default function Page() {
  return (
    <Suspense>
      <BillingQueues />
    </Suspense>
  );
}
