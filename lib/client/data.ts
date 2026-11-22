"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * SEAL's page data cache (stale-while-revalidate, kept for the whole visit).
 *
 * - A page shows the last data it had at once, then refreshes it in the background, so moving
 *   between tabs is instant after the first visit.
 * - `prefetch()` warms a page's data before it is opened (the top bar calls it on hover and when
 *   the app is idle).
 * - A page can pass `initial`: data the server started loading while it sent the page (streamed
 *   with the HTML), which saves a round trip on the first visit.
 * - Entries are kept per hospital (the `seal-tenant` cookie), so switching hospital never shows
 *   the other hospital's numbers.
 */
type Entry = { data?: unknown; at: number; inflight?: Promise<unknown>; error?: string };

const store = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const EMPTY: Entry = { at: 0 };

const tenant = () => (typeof document === "undefined" ? "" : (document.cookie.match(/(?:^|;\s*)seal-tenant=([^;]+)/)?.[1] ?? "basic"));
const keyOf = (url: string) => `${tenant()}|${url}`;

function set(k: string, e: Entry) {
  store.set(k, e);
  listeners.get(k)?.forEach((f) => f());
}

/** Fetch now (sharing a request already on its way) and store the answer. */
export function load<T>(url: string): Promise<T> {
  const k = keyOf(url);
  const cur = store.get(k) ?? EMPTY;
  if (cur.inflight) return cur.inflight as Promise<T>;
  const p = fetch(url)
    .then(async (r) => {
      const j = await r.json().catch(() => ({ error: `request failed (${r.status})` }));
      if (!r.ok || j?.error) throw new Error(j?.error ?? `request failed (${r.status})`);
      return j as T;
    })
    .then(
      (data) => {
        set(k, { data, at: Date.now() });
        return data;
      },
      (e: Error) => {
        set(k, { ...(store.get(k) ?? EMPTY), inflight: undefined, error: e.message });
        throw e;
      },
    );
  set(k, { ...cur, inflight: p });
  return p;
}

/** Warm a URL unless it is fresh or already loading. */
export function prefetch(url: string, maxAgeMs = 15_000) {
  const e = store.get(keyOf(url));
  if (e?.inflight || (e?.data !== undefined && Date.now() - e.at < maxAgeMs)) return;
  load(url).catch(() => {});
}

/** Store data that arrived another way (streamed with the page). */
export function prime(url: string, data: unknown) {
  set(keyOf(url), { data, at: Date.now() });
}

/**
 * Read a URL through the cache. Shows cached data at once; refetches when it is older than
 * `freshMs` (default 3 s, so a hover-prefetch is used as is) and every `refreshMs` if given.
 */
export function useData<T>(url: string | null, opts: { refreshMs?: number; initial?: Promise<T | null>; freshMs?: number } = {}) {
  const { refreshMs, initial, freshMs = 3000 } = opts;
  const k = url ? keyOf(url) : "";
  const entry = useSyncExternalStore(
    useCallback(
      (f: () => void) => {
        if (!k) return () => {};
        const s = listeners.get(k) ?? new Set();
        s.add(f);
        listeners.set(k, s);
        return () => s.delete(f);
      },
      [k],
    ),
    () => (k ? (store.get(k) ?? EMPTY) : EMPTY),
    () => EMPTY,
  );

  // Streamed data is used once, on the first mount; after that the cache and refetches take over.
  const usedInitial = useRef(false);
  useEffect(() => {
    if (!url) return;
    if (initial && !usedInitial.current) {
      usedInitial.current = true;
      // Streamed data arrives as React's own thenable: wrap it to get a real Promise.
      Promise.resolve(initial)
        .then((d) => (d == null ? load(url) : prime(url, d)))
        .catch(() => load(url).catch(() => {}));
    } else {
      const e = store.get(keyOf(url));
      if (!e || e.data === undefined || Date.now() - e.at > freshMs) load(url).catch(() => {});
    }
    if (!refreshMs) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load(url).catch(() => {});
    }, refreshMs);
    return () => clearInterval(t);
  }, [url, initial, refreshMs, freshMs]);

  const reload = useCallback(() => (url ? load<T>(url) : Promise.resolve(undefined as T)), [url]);
  return { data: entry.data as T | undefined, error: entry.data === undefined ? entry.error : undefined, loading: entry.data === undefined && !entry.error, reload };
}
