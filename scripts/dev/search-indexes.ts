/** Dev check (read-only): Atlas Search/Vector indexes on every collection, and SEAL's regular indexes. */
import { MongoClient } from "mongodb";

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!);
  await c.connect();
  for (const d of (await c.db("admin").admin().listDatabases()).databases) {
    if (["admin", "local", "config"].includes(d.name)) continue;
    for (const { name } of await c.db(d.name).listCollections({}, { nameOnly: true }).toArray()) {
      try {
        const idx = await c.db(d.name).collection(name).listSearchIndexes().toArray();
        for (const i of idx as { name: string; type?: string; status?: string }[]) console.log(`search index: ${d.name}.${name} → ${i.name} (${i.type ?? "search"}, ${i.status})`);
      } catch {
        /* views etc. */
      }
    }
  }
  const seal = c.db(process.env.MONGODB_DB ?? "seal");
  let n = 0;
  for (const { name } of await seal.listCollections({}, { nameOnly: true }).toArray()) n += (await seal.collection(name).indexes()).length;
  console.log(`seal regular indexes: ${n}`);
  await c.close();
}
main();
