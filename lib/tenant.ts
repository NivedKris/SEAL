/**
 * Hospitals (tenants). Every hospital shares SEAL's public knowledge (code sets, DHA and DOH rules,
 * the regional claim memory, the AI). A hospital with its own history gets its own database on top:
 * its doctors, its insurers, and its past claims tune what SEAL shows and how it scores risk.
 */
export type TenantId = "basic" | "apollo";
export type Tenant = {
  id: TenantId;
  /** Shown in the hospital switcher. */
  label: string;
  hospital: string;
  /** Database name; null = the default (MONGODB_DB). */
  db: string | null;
  logo?: { src: string; width: number; height: number };
  /** Short line under the name in the switcher. */
  note: string;
  /** How SEAL is deployed at this hospital (hospitals with their own deployment). */
  deployment?: { where: string; model: string; tuning: string; data: string[]; users: string[]; demoNote: string };
  /** For the hospital picker. */
  card: { kicker: string; title: string; body: string; facts: { v: string; k: string }[]; points: string[]; cta: string };
};

export const TENANTS: Record<TenantId, Tenant> = {
  basic: {
    id: "basic",
    label: "SEAL Basic",
    hospital: "Seabreeze Specialty Hospital",
    db: null,
    note: "Public rules and regional claim memory",
    card: {
      kicker: "For any hospital",
      title: "SEAL Basic",
      body: "Ready on day one. SEAL checks every order and every claim against the published DHA and DOH rules and its regional memory of past claims.",
      facts: [
        { v: "30", k: "insurer rules" },
        { v: "20,176", k: "past claims in memory" },
        { v: "4", k: "insurers" },
      ],
      points: ["Doctors, coders and billing in one place", "Explains every decision", "Shown with a sample hospital, Seabreeze"],
      cta: "Open SEAL Basic",
    },
  },
  apollo: {
    id: "apollo",
    label: "Apollo Clinic",
    hospital: "Apollo Clinic",
    db: "seal_apollo",
    logo: { src: "/tenants/apollo/logo.png", width: 136, height: 72 },
    note: "Basic + 57,140 of Apollo's own claims",
    deployment: {
      where: "On Apollo Clinic's own servers, between its HMS and the insurers. Claim data never leaves the clinic.",
      model: "An open-weight language model of 8 to 27 billion parameters, running on-premises",
      tuning: "Fine-tuned on Apollo's history (instruction and critique tuning), then retrained on each new batch of finished claims with Train AI",
      data: ["57,140 of Apollo's claims, Jan 2025 – Oct 2026, with patient details removed", "Published DHA and DOH rules", "SEAL's regional memory of past claims"],
      users: ["Doctors", "Coders", "Billing team", "Finance"],
      demoNote: "In this demo the AI runs on a hosted model; at Apollo it runs on the clinic's own hardware.",
    },
    card: {
      kicker: "Tuned for one hospital",
      title: "Apollo Clinic",
      body: "Everything in Basic, plus Apollo's own history: how each insurer treats Apollo, what each doctor's claims run into, and how its money arrives.",
      facts: [
        { v: "57,140", k: "of Apollo's own claims" },
        { v: "15", k: "clinicians" },
        { v: "55", k: "insurers" },
      ],
      points: ["Runs on Apollo's premises, between its HMS and the insurers", "Its own AI, trained on its own claims", "A Train AI button for every new batch"],
      cta: "Open Apollo Clinic",
    },
  },
};
export const TENANT_COOKIE = "seal-tenant";
export const isTenant = (x: unknown): x is TenantId => x === "basic" || x === "apollo";
