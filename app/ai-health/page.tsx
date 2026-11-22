import { AiHealth } from "@/components/health/ai-health";
import { db } from "@/lib/db/mongo";
import { aiHealthView, plain } from "@/lib/views/pages";

export const metadata = { title: "AI Health" };

/** Insights start loading on the server and stream in with the page. */
export default function Page() {
  const initial = db().then(aiHealthView).then(plain).catch(() => null);
  return <AiHealth initial={initial as never} />;
}
