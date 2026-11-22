/**
 * SEAL's map, as the assistant understands it: every screen and tab, what is on it, the words people
 * use for it, and how to open it already filtered. The assistant can only go where this map says,
 * so it never sends anyone to a page that does not exist. Shared by the server (instructions, tool
 * schema) and the browser (turning a destination into a link).
 */

export type Destination = {
  screen: ScreenKey;
  /** Claims tab: attention, ready, sent, paid, refused. */
  tab?: string;
  /** A doctor's id (Patients, Questions). */
  doctor?: string;
  /** One claim's id (opens the claim). */
  claim?: string;
  /** One patient visit's id (opens it in Patients). */
  visit?: string;
  /** One question set's id (opens it in Questions). */
  questionSet?: string;
  /** A chosen set of claim ids, shown as one list in Claims. */
  claims?: string[];
  /** The heading for that list, e.g. "Your last 10 claims". */
  title?: string;
  /** A link an item on screen gave (get_screen), e.g. /billing/claims/clm-L000004. Checked against the map. */
  link?: string;
};

export type ScreenKey = "today" | "patients" | "questions" | "claims" | "claim" | "finance" | "rules" | "insights" | "settings";

type Screen = { key: ScreenKey; path: string; name: string; shows: string; words: string[] };

export const SCREENS: Screen[] = [
  { key: "today", path: "/today", name: "Today", shows: "the hospital's day at a glance: claims by stage (seen, signed, questions, needs attention, ready, with the insurer, accepted), money accepted and at risk, every doctor's day, what needs someone now, how each insurer treats the hospital", words: ["home", "dashboard", "overview", "start", "main screen"] },
  { key: "patients", path: "/emr", name: "Patients", shows: "today's clinic list (all doctors, or one doctor's) and the open patient visit: the note, orders, diagnoses, and SEAL checking each order live", words: ["EMR", "visits", "patient list", "clinic list", "consultations", "appointments", "a doctor's patients"] },
  { key: "questions", path: "/doctor", name: "Questions", shows: "SEAL's questions for doctors (what the insurer needs before it pays), per doctor, answered on the phone", words: ["doctor questions", "doctor inbox", "queries", "what doctors need to answer"] },
  { key: "claims", path: "/billing", name: "Claims", shows: "every claim by tab: Needs attention (held by SEAL), Ready to send, With the insurer, Paid, Refused (refused claims and appeals, with SEAL's drafted corrections). Also any chosen list of claims", words: ["billing", "claims list", "claims queue", "refused = rejected = denied = declined", "with the insurer = sent = submitted = pending", "needs attention = held = on hold", "appeals", "resubmissions"] },
  { key: "claim", path: "/billing/claims/<id>", name: "One claim", shows: "one claim: its lines, risk, why it is held, SEAL's reasoning trace, the fixes, the insurer's answer", words: ["claim detail", "open claim", "that claim"] },
  { key: "finance", path: "/clinic", name: "Finance", shows: "first-time acceptance over time, cash at risk, cash recovered, days to cash, where money is lost by reason and by insurer", words: ["money", "revenue", "CFO", "cash", "finance dashboard"] },
  { key: "rules", path: "/rules", name: "Rules", shows: "the insurer rules SEAL checks (with their sources) and new rules SEAL has learned, waiting for approval", words: ["insurer rules", "policies", "payer rules", "learned rules"] },
  { key: "insights", path: "/ai-health", name: "Insights", shows: "how well SEAL is doing: accuracy, what it learned from the hospital's history, AI cost, safety, doctors' answer rate, Train AI", words: ["AI health", "how SEAL is doing", "accuracy", "learning", "train AI"] },
  { key: "settings", path: "/admin", name: "Settings", shows: "demo controls: reset the demo, run the evaluation", words: ["admin", "settings", "reset"] },
];

/** Claims tabs: what people say → the tab key the Claims screen uses. */
export const CLAIM_TABS: Record<string, { key: string; name: string }> = {
  attention: { key: "hold", name: "Needs attention" },
  ready: { key: "ready", name: "Ready to send" },
  sent: { key: "submitted", name: "With the insurer" },
  paid: { key: "paid", name: "Paid" },
  refused: { key: "refused", name: "Refused" },
};
/** Every spelling a link may carry, to the Claims screen's own tab key. */
export const tabKey = (t?: string | null) => {
  if (!t) return null;
  const x = t.toLowerCase();
  if (CLAIM_TABS[x]) return CLAIM_TABS[x].key;
  if (["hold", "held", "checking", "needs attention"].includes(x)) return "hold";
  if (["submitted", "resubmitted", "with the insurer", "pending"].includes(x)) return "submitted";
  if (["rejected", "denied", "declined", "partially_paid", "appeals"].includes(x)) return "refused";
  return ["ready", "paid", "refused"].includes(x) ? x : null;
};

const safe = (s: string) => /^[A-Za-z0-9._-]{1,64}$/.test(s);

/** A destination → the link that opens it, or an error saying why it cannot be opened. */
export function pathFor(d: Destination): { path: string; label: string } | { error: string } {
  if (d.link) {
    const ok = /^\/[A-Za-z0-9/_.,=&?%-]*$/.test(d.link) && SCREENS.some((s) => d.link!.split("?")[0] === s.path || (s.key === "claim" && /^\/billing\/claims\/[A-Za-z0-9._-]+$/.test(d.link!.split("?")[0])));
    return ok ? { path: d.link, label: SCREENS.find((s) => d.link!.startsWith(s.path))?.name ?? "That screen" } : { error: `"${d.link}" is not a SEAL screen` };
  }
  const q = new URLSearchParams();
  switch (d.screen) {
    case "claim":
      if (!d.claim || !safe(d.claim)) return { error: "which claim? give its id (e.g. clm-L000004)" };
      return { path: `/billing/claims/${d.claim}`, label: `Claim ${d.claim.replace(/^clm-/, "")}` };
    case "claims": {
      if (d.claims?.length) {
        const ids = d.claims.filter(safe).slice(0, 50);
        if (!ids.length) return { error: "no valid claim ids" };
        q.set("ids", ids.join(","));
        if (d.title) q.set("title", d.title.slice(0, 80));
        return { path: `/billing?${q}`, label: d.title ?? `${ids.length} claims` };
      }
      const t = tabKey(d.tab);
      if (d.tab && !t) return { error: `no Claims tab "${d.tab}"; tabs are attention, ready, sent, paid, refused` };
      if (t) q.set("tab", t);
      const name = Object.values(CLAIM_TABS).find((x) => x.key === t)?.name;
      return { path: `/billing${t ? `?${q}` : ""}`, label: name ? `Claims · ${name}` : "Claims" };
    }
    case "patients":
      if (d.doctor && safe(d.doctor)) q.set("providerId", d.doctor);
      if (d.visit && safe(d.visit)) q.set("e", d.visit);
      return { path: `/emr${q.size ? `?${q}` : ""}`, label: d.visit ? "The patient's visit" : d.doctor ? "Their patients today" : "Patients" };
    case "questions":
      if (d.doctor && safe(d.doctor)) q.set("providerId", d.doctor);
      if (d.questionSet && safe(d.questionSet)) q.set("q", d.questionSet);
      return { path: `/doctor${q.size ? `?${q}` : ""}`, label: "Questions" };
    default: {
      const s = SCREENS.find((x) => x.key === d.screen);
      return s ? { path: s.path, label: s.name } : { error: `unknown screen "${d.screen}"` };
    }
  }
}

/** The map in words, for the assistant's instructions. */
export function describeSitemap() {
  return [
    "SEAL's screens (go there with navigate; never invent other pages):",
    ...SCREENS.map((s) => `- ${s.key} (${s.name}): ${s.shows}. People also say: ${s.words.join(", ")}.`),
    `- Claims tabs: ${Object.entries(CLAIM_TABS).map(([k, v]) => `${k} = "${v.name}"`).join(", ")}.`,
  ].join("\n");
}
