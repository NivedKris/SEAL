/**
 * Load past years of post-office files into SEAL's memory.
 *
 *   npm run history:import -- <folder-of-xml> [--dry-run] [--no-embed]
 *   npm run history:import -- --windows 2023-01-01 2025-12-31   (prints the ≤100-day search windows)
 *
 * The folder holds the facility's own Claim.Submission and Remittance.Advice XML files, as
 * downloaded from DHPO (eClaimLink) or Shafafiya: SearchTransactions per window, then
 * DownloadTransactionFile for each result. Sub-folders are read too.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { db, mongoClient } from "@/lib/db/mongo";
import { importHistory, searchWindows } from "@/lib/history/import";

const args = process.argv.slice(2);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.xml$/i.test(n) ? [p] : [];
  });
}

async function main() {
  if (args[0] === "--windows") {
    for (const w of searchWindows(new Date(args[1]), new Date(args[2]))) console.log(`${w.from}  →  ${w.to}`);
    return;
  }
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) throw new Error("usage: npm run history:import -- <folder> [--dry-run] [--no-embed]");
  const paths = walk(dir);
  console.log(`reading ${paths.length} XML files from ${dir}`);
  const files = paths.map((p) => ({ name: p, xml: readFileSync(p, "utf8") }));
  const r = await importHistory(files, await db(), { dryRun: args.includes("--dry-run"), embed: !args.includes("--no-embed") });
  console.log(JSON.stringify({ ...r, badFiles: r.badFiles.slice(0, 10), badFileCount: r.badFiles.length }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => (await mongoClient()).close());
