/** Dev check: document counts per collection in the SEAL database (read-only). */
import { MongoClient } from "mongodb";

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!);
  await c.connect();
  const db = c.db(process.env.MONGODB_DB ?? "seal");
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    console.log(name.padEnd(14), await db.collection(name).estimatedDocumentCount());
  }
  await c.close();
}
main();
