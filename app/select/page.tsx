import type { Metadata } from "next";
import { HospitalPicker } from "@/components/select/hospital-picker";

export const metadata: Metadata = { title: "Choose your hospital" };

export default function SelectPage() {
  return <HospitalPicker />;
}
