import type { Metadata } from "next";
import { Today } from "@/components/today/today";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() {
  return <Today />;
}
