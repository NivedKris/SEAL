import { Suspense } from "react";
import { PhoneFrame } from "@/components/shell/phone-frame";
import { DoctorApp } from "@/components/doctor/doctor-app";

export const metadata = { title: "Doctor" };

export default function DoctorPage() {
  return (
    <PhoneFrame>
      <Suspense>
        <DoctorApp />
      </Suspense>
    </PhoneFrame>
  );
}
