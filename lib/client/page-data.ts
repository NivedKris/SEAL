"use client";

import { prefetch } from "./data";

/** The data each tab opens with (the page cache's URLs), so it can be warmed before it is opened. */
export const claimsUrl = (statuses: readonly string[]) => `/api/claims?status=${statuses.join(",")}&limit=60&scope=live`;
export const REFUSED_COUNT = "/api/recovery?limit=0";

export const PAGE_DATA: Record<string, string[]> = {
  "/today": ["/api/today"],
  "/emr": ["/api/encounters?status=open"],
  "/doctor": ["/api/questions?status=open"],
  "/billing": [claimsUrl(["checking", "hold"]), REFUSED_COUNT],
  "/clinic": ["/api/clinic"],
  "/rules": ["/api/rules"],
  "/ai-health": ["/api/ai-health"],
};

/** Warm one tab's data (on hover, focus or touch of its link). */
export const warmPage = (href: string) => PAGE_DATA[href]?.forEach((u) => prefetch(u));

const warmed = new Set<string>();
/** Once per visit and hospital, when the browser is idle: warm every tab, so the first click on each is instant. */
export function warmAllWhenIdle(except?: string) {
  if (typeof window === "undefined") return;
  const tenant = document.cookie.match(/(?:^|;\s*)seal-tenant=([^;]+)/)?.[1] ?? "basic";
  if (warmed.has(tenant)) return;
  warmed.add(tenant);
  const go = () => Object.keys(PAGE_DATA).filter((h) => h !== except).forEach((h, i) => setTimeout(() => warmPage(h), i * 150));
  const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void };
  setTimeout(() => (w.requestIdleCallback ? w.requestIdleCallback(go, { timeout: 4000 }) : go()), 1500);
}
