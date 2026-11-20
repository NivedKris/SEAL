import { Suspense } from "react";
import { EmrScreen } from "@/components/emr/emr-screen";

export const metadata = { title: "EMR" };

export default function Page() {
  return (
    <Suspense>
      <EmrScreen />
    </Suspense>
  );
}
