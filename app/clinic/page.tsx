import { Clinic } from "@/components/clinic/clinic";
import { db } from "@/lib/db/mongo";
import { clinicView, plain } from "@/lib/views/pages";

export const metadata = { title: "Clinic" };

/** Finance numbers start loading on the server and stream in with the page. */
export default function Page() {
  const initial = db().then(clinicView).then(plain).catch(() => null);
  return <Clinic initial={initial as never} />;
}
