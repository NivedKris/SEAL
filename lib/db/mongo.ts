import "server-only";
import { MongoClient, type Db } from "mongodb";
import { env } from "@/lib/env";
import { currentTenant } from "@/lib/tenant-server";

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

/** The current hospital's database (Basic unless the request is signed in to another hospital). */
export async function db(): Promise<Db> {
  const t = await currentTenant();
  return (await mongoClient()).db(t.db ?? env.MONGODB_DB);
}

/**
 * SEAL's shared knowledge (the regional memory of past claims every hospital starts from). It is
 * stored once, in the Basic database; hospitals read it from there and keep only their own data.
 */
export async function sharedDb(): Promise<Db> {
  return (await mongoClient()).db(env.MONGODB_DB);
}

/** A named hospital's database, for scripts and cross-hospital work. */
export async function tenantDb(name: string | null): Promise<Db> {
  return (await mongoClient()).db(name ?? env.MONGODB_DB);
}
