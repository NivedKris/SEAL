/** Give every doctor today's clinic (open visits from their own history). Safe to re-run. */
import { db, mongoClient } from "@/lib/db/mongo";
import { seedClinics } from "@/lib/admin/clinics";
(async () => {
  const r = await seedClinics(await db());
  console.log(JSON.stringify(r, null, 1));
  await (await mongoClient()).close();
})();
