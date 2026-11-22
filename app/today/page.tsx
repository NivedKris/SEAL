import type { Metadata } from "next";
import { Today } from "@/components/today/today";
import { db } from "@/lib/db/mongo";
import { todayMetrics } from "@/lib/today/metrics";
import { plain } from "@/lib/views/pages";

export const metadata: Metadata = { title: "Today" };

/** Today's numbers start loading on the server and stream in with the page. */
export default function TodayPage() {
  const initial = db().then(todayMetrics).then(plain).catch(() => null);
  return <Today initial={initial} />;
}
