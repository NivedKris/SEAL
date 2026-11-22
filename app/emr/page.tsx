import { Suspense } from "react";
import { EmrScreen } from "@/components/emr/emr-screen";
import { db } from "@/lib/db/mongo";
import { encounterList, encounterView, plain } from "@/lib/views/pages";

export const metadata = { title: "EMR" };

/**
 * The patient list and the first visit start loading on the server while the page is sent, and
 * stream in with it (not awaited here, so the page itself is never held up).
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ e?: string; providerId?: string }> }) {
  const q = await searchParams;
  const d = db();
  const list = d.then((x) => encounterList(x)).then(plain).catch(() => null);
  const visit = Promise.all([d, list])
    .then(([x, l]) => {
      const id = q.e ?? (l?.encounters as { _id: unknown; providerId?: string }[] | undefined)?.find((e) => !q.providerId || e.providerId === q.providerId)?._id;
      return id ? encounterView(x, String(id)).then(plain) : null;
    })
    .catch(() => null);
  return (
    <Suspense>
      <EmrScreen initialList={list as never} initialVisit={visit as never} />
    </Suspense>
  );
}
