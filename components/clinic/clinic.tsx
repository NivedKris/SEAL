"use client";

import { SealLoader } from "@/components/brand/seal-loader";
import { useEffect, useMemo, useState } from "react";
import CountUp from "@/components/CountUp";
import { Chart, VIZ, axisBase } from "@/components/health/chart";

type M = {
  firstPass: { rate: number | null; claims: number; byMonth: { month: string; n: number; rate: number }[] };
  cashAtRisk: { held: { claims: number; amount: number }; refusedOpen: { lines: number; amount: number } };
  recovered: { history?: { lines: number; amount: number }; seal?: { lines: number; amount: number } };
  daysToCash: { median: number | null; p90: number | null };
  byOrderType: { kind: string; lines: number; refusalRate: number; lost: number }[];
  byPayer: { payerId: string; name: string; top: { code: string; n: number; amount: number }[]; lost: number }[];
};
const K = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : n.toFixed(0));
const MONTH = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", year: "2-digit" });

export function Clinic() {
  const [m, setM] = useState<M | null>(null);
  useEffect(() => {
    fetch("/api/clinic").then((r) => r.json()).then(setM);
  }, []);
  const trend = useMemo(
    () =>
      m && {
        grid: { left: 44, right: 16, top: 20, bottom: 28 },
        tooltip: { trigger: "axis", formatter: (ps: { dataIndex: number }[]) => { const x = m.firstPass.byMonth[ps[0].dataIndex]; return `${MONTH(x.month)}<br/>${(x.rate * 100).toFixed(1)}% paid first time<br/>${x.n} claims`; } },
        xAxis: { type: "category", data: m.firstPass.byMonth.map((x) => MONTH(x.month)), ...axisBase },
        yAxis: { type: "value", min: 0.7, max: 1, ...axisBase, axisLabel: { ...axisBase.axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } },
        series: [{ name: "First-pass acceptance", type: "line", data: m.firstPass.byMonth.map((x) => x.rate), symbolSize: 8, itemStyle: { color: VIZ.s1, borderColor: "#fff", borderWidth: 2 }, lineStyle: { color: VIZ.s1, width: 2 } }],
      },
    [m],
  );
  const types = useMemo(
    () =>
      m && {
        grid: { left: 80, right: 40, top: 8, bottom: 24 },
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps: { dataIndex: number }[]) => { const x = m.byOrderType[ps[0].dataIndex]; return `${x.kind}<br/>${(x.refusalRate * 100).toFixed(1)}% of ${x.lines.toLocaleString()} lines refused<br/>AED ${x.lost.toLocaleString()} refused`; } },
        xAxis: { type: "value", ...axisBase, axisLabel: { ...axisBase.axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } },
        yAxis: { type: "category", inverse: true, data: m.byOrderType.map((x) => x.kind), ...axisBase, splitLine: { show: false } },
        series: [{ name: "Refusal rate", type: "bar", data: m.byOrderType.map((x) => x.refusalRate), barMaxWidth: 16, itemStyle: { color: VIZ.s1, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: "right", color: VIZ.muted, fontSize: 11, formatter: (p: { value: number }) => `${(p.value * 100).toFixed(1)}%` } }],
      },
    [m],
  );
  if (!m) return <SealLoader className="min-h-[70vh]" size={44} />;
  const atRisk = m.cashAtRisk.held.amount + m.cashAtRisk.refusedOpen.amount;
  return (
    <main className="mx-auto max-w-[1400px] px-6 pb-24 pt-12">
      <div className="flex items-center gap-3">
        <p className="text-[13px] font-medium text-muted-foreground">Khalid Al Suwaidi · CFO</p>
      </div>
      <h1 className="display mt-1 text-[52px] leading-tight">Finance at a glance</h1>
      <div className="mt-8 grid grid-cols-4 gap-4">
        <Hero label="First-pass acceptance" value={(m.firstPass.rate ?? 0) * 100} decimals={1} suffix="%" sub={`${m.firstPass.claims.toLocaleString()} claims, last 12 months`} />
        <Hero label="Cash at risk" value={atRisk} prefix="AED " compact sub={`${m.cashAtRisk.held.claims} held claims · ${m.cashAtRisk.refusedOpen.lines} refused lines still recoverable`} />
        <Hero label="Cash recovered" value={(m.recovered.history?.amount ?? 0) + (m.recovered.seal?.amount ?? 0)} prefix="AED " compact sub={`${(m.recovered.history?.lines ?? 0) + (m.recovered.seal?.lines ?? 0)} refused lines won back${m.recovered.seal ? ` · AED ${K(m.recovered.seal.amount)} by SEAL` : ""}`} />
        <Hero label="Days to cash" value={m.daysToCash.median ?? 0} suffix=" days" sub={`median · 90th percentile ${m.daysToCash.p90 ?? "—"} days`} />
      </div>
      <div className="mt-10 grid grid-cols-[1.4fr_1fr] gap-8">
        <section>
          <h2 className="text-[20px] font-semibold">First-pass acceptance by month</h2>
          <div className="mt-3 card p-5">{trend && <Chart option={trend} height={260} />}</div>
        </section>
        <section>
          <h2 className="text-[20px] font-semibold">Refusal rate by order type</h2>
          <div className="mt-3 card p-5">{types && <Chart option={types} height={260} />}</div>
        </section>
      </div>
      <section className="mt-10">
        <h2 className="text-[20px] font-semibold">Top refusal reasons by insurer</h2>
        <div className="mt-3 grid grid-cols-4 gap-4">
          {m.byPayer.map((p) => (
            <div key={p.payerId} className="card p-6">
              <div className="flex items-baseline justify-between">
                <span className="text-[15px] font-semibold">{p.name}</span>
                <span className="font-mono text-[12px] text-muted-foreground">AED {K(p.lost)} refused</span>
              </div>
              <ul className="mt-3 space-y-2">
                {p.top.map((r) => (
                  <li key={r.code} className="text-[12px]">
                    <div className="flex justify-between"><span className="font-mono">{r.code}</span><span className="text-muted-foreground">{r.n} lines · AED {K(r.amount)}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-foreground/70" style={{ width: `${(r.amount / Math.max(1, p.top[0].amount)) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Hero({ label, value, sub, prefix = "", suffix = "", decimals = 0, compact }: { label: string; value: number; sub: string; prefix?: string; suffix?: string; decimals?: number; compact?: boolean }) {
  const v = compact && value >= 1000 ? value / 1000 : value;
  return (
    <div className="card p-7">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-[38px] font-semibold leading-tight tracking-tight tabular-nums">
        {prefix}
        <CountUp to={v} decimals={compact && value >= 1000 ? 0 : decimals} duration={1} trigger="load" />
        {compact && value >= 1000 ? "k" : ""}
        {suffix}
      </div>
      <div className="mt-1 text-[12px] text-muted-foreground">{sub}</div>
    </div>
  );
}
