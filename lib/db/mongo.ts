import "server-only";
import { MongoClient, type Db } from "mongodb";
import { env } from "@/lib/env";

/**
 * One MongoClient per function instance, reused across invocations (Vercel-safe).
 * Memory is only a connection cache; all state lives in Atlas (plan §6).
 */
const g = globalThis as unknown as { _sealMongo?: Promise<MongoClient> };

export function mongoClient(): Promise<MongoClient> {
  g._sealMongo ??= new MongoClient(env.MONGODB_URI, {
    maxPoolSize: 10,
    // Keep a few connections open so the first claim check after a cold start doesn't pay for TLS handshakes.
    minPoolSize: 4,
    serverSelectionTimeoutMS: 8000,
    appName: "seal",
    // Optional fields stay absent instead of being stored as null (eClaimLink rejects empty elements).
    ignoreUndefined: true,
  })
    .connect()
    .catch((e) => {
      // Never cache a failed connection: the next request retries (Atlas can blip for a few seconds).
      g._sealMongo = undefined;
      throw e;
    });
  return g._sealMongo;
}

export async function db(): Promise<Db> {
  return (await mongoClient()).db(env.MONGODB_DB);
}
