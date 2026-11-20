/** Dev check: logical data + index size per database on the Atlas cluster (read-only). */
import { MongoClient } from "mongodb";

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!);
  await c.connect();
  const { databases } = await c.db("admin").admin().listDatabases();
  let data = 0;
  let idx = 0;
  for (const d of databases) {
    if (["admin", "local", "config"].includes(d.name)) continue;
    const s = await c.db(d.name).command({ dbStats: 1, scale: 1024 * 1024 });
    data += s.dataSize;
    idx += s.indexSize;
    console.log(d.name.padEnd(10), `data ${s.dataSize.toFixed(1)} MB`, `indexes ${s.indexSize.toFixed(1)} MB`, `storage ${s.storageSize.toFixed(1)} MB`);
  }
  console.log(`total data ${data.toFixed(1)} MB + indexes ${idx.toFixed(1)} MB = ${(data + idx).toFixed(1)} MB`);
  await c.close();
}
main();
