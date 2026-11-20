"use client";

import CountUp from "@/components/CountUp";
import { cn } from "@/lib/utils";

/** Risk bands used everywhere in billing: low < 30%, medium < 60%, high ≥ 60%. */
export const riskBand = (p: number) => (p >= 0.6 ? "high" : p >= 0.3 ? "mid" : "low");
export const riskText = { low: "text-risk-low", mid: "text-risk-mid", high: "text-risk-high" } as const;
const riskFill = { low: "bg-risk-low", mid: "bg-risk-mid", high: "bg-risk-high" } as const;
const riskStroke = { low: "var(--risk-low)", mid: "var(--risk-mid)", high: "var(--risk-high)" } as const;

/** Horizontal refusal-risk gauge for one claim line. */
export function RiskBar({ p, className }: { p: number | null | undefined; className?: string }) {
  if (p == null) return <div className={cn("h-1.5 w-full animate-pulse rounded-full bg-secondary", className)} />;
  const b = riskBand(p);
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", riskFill[b])} style={{ width: `${Math.max(3, p * 100)}%` }} />
      </div>
      <span className={cn("w-10 text-right font-mono text-[13px] tabular-nums", riskText[b])}>{Math.round(p * 100)}%</span>
    </div>
  );
}

/** Claim-level refusal probability as a ring with a counting figure. */
export function RiskRing({ p, size = 168 }: { p: number | null | undefined; size?: number }) {
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const b = p == null ? "low" : riskBand(p);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--secondary)" strokeWidth={10} />
        {p != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={riskStroke[b]}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - p)}
            style={{ transition: "stroke-dashoffset 900ms cubic-bezier(.2,.8,.2,1)" }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {p == null ? (
          <span className="text-sm text-muted-foreground">Scoring…</span>
        ) : (
          <>
            <span className={cn("text-[44px] font-semibold leading-none tracking-tight", riskText[b])}>
              <CountUp key={Math.round(p * 100)} to={Math.round(p * 100)} duration={0.9} trigger="load" />
              <span className="text-2xl">%</span>
            </span>
            <span className="mt-1.5 text-[12px] text-muted-foreground">refusal risk</span>
          </>
        )}
      </div>
    </div>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-secondary text-foreground" },
  checking: { label: "Checking", cls: "bg-foreground text-background" },
  hold: { label: "Hold", cls: "bg-risk-high/10 text-risk-high" },
  ready: { label: "Ready", cls: "bg-risk-low/10 text-risk-low" },
  submitted: { label: "Submitted", cls: "bg-secondary text-foreground" },
  resubmitted: { label: "Resubmitted", cls: "bg-secondary text-foreground" },
  paid: { label: "Paid", cls: "bg-risk-low/10 text-risk-low" },
  partially_paid: { label: "Partly paid", cls: "bg-risk-mid/10 text-risk-mid" },
  refused: { label: "Refused", cls: "bg-risk-high/10 text-risk-high" },
  closed: { label: "Closed", cls: "bg-secondary text-muted-foreground" },
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-secondary" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium", s.cls, className)}>
      {status === "checking" && <span className="size-1.5 animate-pulse rounded-full bg-seal-green" />}
      {s.label}
    </span>
  );
}

export const aed = (n: number) => `AED ${n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const initials = (name?: string) => (name ?? "?").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
