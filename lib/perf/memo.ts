import "server-only";
import type { Db } from "mongodb";

/**
 * Stored totals: numbers that are expensive to work out from the full history (20k+ claims) but
 * barely change between visits. Each one is kept in memory and in the hospital's own `rollups`
 * collection, so even a fresh server reads one small document instead of recounting.
 *
 * Stale-while-revalidate: a value younger than `ttlMs` is served as is; an older one is still
 * served at once while a fresh copy is worked out in the background. Only the very first visit
 * ever (nothing stored yet) waits for the calculation. `forget()` drops a value after a write that
 * changes it (new remittances, a learning run), so the next visit refreshes it.
 */
export const ROLLUPS = "rollups";

type Entry = { at: number; value: unknown };
const g = globalThis as unknown as { _sealMemo?: Map<string, Entry>; _sealMemoBusy?: Map<string, Promise<unknown>> };
const mem = (g._sealMemo ??= new Map());
const busy = (g._sealMemoBusy ??= new Map());

/** Bump when a stored shape changes, so old documents are ignored. */
const VERSION = 2;

function compute<T>(d: Db, key: string, fn: () => Promise<T>): Promise<T> {
  const id = `${d.databaseName}:${key}`;
  const running = busy.get(id) as Promise<T> | undefined;
  if (running) return running;
  const p = fn()
    .then(async (value) => {
      const at = Date.now();
      mem.set(id, { at, value });
      await d
        .collection<{ _id: string }>(ROLLUPS)
        .updateOne({ _id: key }, { $set: { at, v: VERSION, value: JSON.parse(JSON.stringify(value)) } }, { upsert: true })
        .catch(() => {});
      return value;
    })
    .finally(() => busy.delete(id));
  busy.set(id, p);
  return p;
}

export async function memo<T>(d: Db, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const id = `${d.databaseName}:${key}`;
  let e = mem.get(id);
  if (!e) {
    const doc = await d.collection<{ _id: string; at: number; v: number; value: T }>(ROLLUPS).findOne({ _id: key });
    if (doc && doc.v === VERSION) mem.set(id, (e = { at: doc.at, value: doc.value }));
  }
  if (!e) return compute(d, key, fn);
  if (Date.now() - e.at > ttlMs) void compute(d, key, fn).catch(() => {});
  return e.value as T;
}

/** Drop stored values (all of this hospital's, or the named ones) so the next visit recounts. */
export async function forget(d: Db, ...keys: string[]) {
  const prefix = `${d.databaseName}:`;
  for (const k of [...mem.keys()]) if (k.startsWith(prefix) && (!keys.length || keys.includes(k.slice(prefix.length)))) mem.set(k, { ...mem.get(k)!, at: 0 });
  await d
    .collection<{ _id: string }>(ROLLUPS)
    .updateMany(keys.length ? { _id: { $in: keys } } : {}, { $set: { at: 0 } })
    .catch(() => {});
}
