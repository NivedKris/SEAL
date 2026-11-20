"use client";

import { SealLoader } from "@/components/brand/seal-loader";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

type AgentCfg = { groqModel: string; targetMs: number };
type A = {
  settings: { insurerDelaySeconds: number; killSwitches: Record<string, boolean>; modelOverrides: Record<string, string>; seedVersion: string };
  judges: { active: string; shadow: string | null };
  agents: Record<string, AgentCfg>;
  models: { groq: Record<string, string>; gemini: { fallback: string[] }; embedding: { model: string; dims: number } };
  counts: Record<string, number>;
  seed: { meta: Record<string, unknown>; assumptions: { key: string; value: string; why: string }[]; counts: Record<string, number> };
};

export function Admin() {
  const [a, setA] = useState<A | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [clearCalls, setClearCalls] = useState(false);
  const load = useCallback(async () => setA(await fetch("/api/admin/settings").then((r) => r.json())), []);
  useEffect(() => {
    void load();
  }, [load]);
  const patch = async (body: object, what: string) => {
    setBusy(what);
    await fetch("/api/admin/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    void load();
  };
  const reset = async () => {
    setBusy("reset");
    setMsg(null);
    const r = await fetch("/api/admin/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "RESET", clearAiCalls: clearCalls }) }).then((x) => x.json());
    setBusy(null);
    setConfirm("");
    setMsg(r.error ? `Reset failed: ${r.error}` : `Fresh day ready: scenarios restored, and ${r.workday?.claims ?? 0} claims from this morning's patients (${r.workday?.held ?? 0} need attention, ${r.workday?.ready ?? 0} ready, ${r.workday?.withInsurer ?? 0} with the insurer, ${r.workday?.paidOrRefused ?? 0} already answered).`);
    void load();
  };
  if (!a) return <SealLoader className="min-h-[70vh]" size={44} />;
  const ks = a.settings.killSwitches ?? {};
  const groqModels = [...new Set(Object.values(a.models.groq))];
  return (
    <main className="mx-auto max-w-[1400px] px-4 md:px-6 pb-24 pt-12">
      <p className="text-[13px] font-medium text-muted-foreground">Administrator · System admin</p>
      <h1 className="display mt-1 text-[34px] md:text-[44px] lg:text-[52px] leading-tight">Settings</h1>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
        <section className="card p-6">
          <h2 className="text-[20px] font-semibold">Demo data</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Seed {String(a.seed.meta.seedVersion)} as of {String(a.seed.meta.asOf)} · {a.counts.claims?.toLocaleString()} claims, {a.counts.outcomes?.toLocaleString()} outcomes, {a.counts.events?.toLocaleString()} events in the database.
          </p>
          <div className="mt-4 rounded-xl bg-secondary p-4 text-[13px]">
            <div className="font-medium">Reset to the seeded state</div>
            <p className="mt-1 text-muted-foreground">Starts a fresh day: removes everything done since, restores the S1–S8 patients, and fills the claims queues with this morning&apos;s patients. Takes about 40 seconds.</p>
            <label className="mt-3 flex items-center gap-2 text-[12px]"><input type="checkbox" checked={clearCalls} onChange={(e) => setClearCalls(e.target.checked)} /> Also clear the AI call log (AI Health starts empty)</label>
            <div className="mt-3 flex gap-2">
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder='Type RESET' className="w-36 rounded-full border border-border bg-background px-3 py-1.5 text-[13px] outline-none" />
              <button onClick={reset} disabled={confirm !== "RESET" || !!busy} className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-[13px] font-medium text-background disabled:opacity-30">
                {busy === "reset" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Reset
              </button>
            </div>
            {msg && <p className="mt-2 text-[12px]">{msg}</p>}
          </div>
          <div className="mt-3 rounded-xl border border-border p-4 text-[13px]">
            <div className="font-medium">Seed the database from scratch</div>
            <p className="mt-1 text-muted-foreground">Loads the committed 20,471-claim seed (validated, storage-guarded) and embeds every outcome. It takes about 25 minutes, longer than a serverless function may run, so it runs from a terminal:</p>
            <code className="mt-2 block rounded-lg bg-secondary px-3 py-2 font-mono text-[12px]">npm run seed:load -- --reset</code>
          </div>
        </section>

        <section className="card p-6">
          <h2 className="text-[20px] font-semibold">Insurer and judges</h2>
          <label className="mt-4 flex items-center justify-between text-[13px]">
            <span>Mock insurer delay (seconds until the remittance is ready)</span>
            <input type="number" min={0} defaultValue={a.settings.insurerDelaySeconds} onBlur={(e) => patch({ insurerDelaySeconds: Number(e.target.value) }, "delay")} className="w-24 rounded-full border border-border px-3 py-1 text-right" />
          </label>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-[13px]">
            {(["active", "shadow"] as const).map((k) => (
              <label key={k} className="block">
                <span className="text-muted-foreground">{k === "active" ? "Active judge (routes claims)" : "Shadow judge (scored alongside)"}</span>
                <select value={(k === "active" ? a.judges.active : a.judges.shadow) ?? ""} onChange={(e) => patch(k === "active" ? { activeJudge: e.target.value } : { shadowJudge: e.target.value || null }, k)} className="mt-1 w-full rounded-full border border-border px-3 py-1.5">
                  {k === "shadow" && <option value="">none</option>}
                  <option value="agentic_llm">Agentic LLM (judge + critic)</option>
                  <option value="trained_model">Trained model (ledger rates)</option>
                </select>
              </label>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between rounded-xl bg-secondary px-4 py-3 text-[13px]">
            <span>
              <span className="font-medium">Disable Groq</span> — every agent runs on Gemini ({a.models.gemini.fallback.join(" → ")})
            </span>
            <Toggle on={!!ks.groq} onClick={() => patch({ killSwitches: { ...ks, groq: !ks.groq } }, "groq")} />
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">Embeddings: {a.models.embedding.model} ({a.models.embedding.dims} dims), local on the server.</p>
        </section>
      </div>

      <section className="mt-8 card p-6">
        <h2 className="text-[20px] font-semibold">Agents</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Switch an agent&apos;s Groq model, or turn it off: the claim check falls back to rules only; other agents use their built-in templates or wait for a person.</p>
        <div className="-mx-2 overflow-x-auto px-2"><table className="mt-4 w-full text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-muted-foreground">
              <th className="pb-2 font-medium">Agent</th>
              <th className="pb-2 font-medium">Groq model</th>
              <th className="pb-2 font-medium">Target</th>
              <th className="pb-2 text-right font-medium">On</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(a.agents).map(([name, cfg]) => (
              <tr key={name} className="border-t border-border/60">
                <td className="py-2 font-mono">{name}</td>
                <td className="py-2">
                  <select value={a.settings.modelOverrides?.[name] ?? ""} onChange={(e) => patch({ modelOverrides: { ...a.settings.modelOverrides, [name]: e.target.value } }, name)} className="rounded-full border border-border px-3 py-1">
                    <option value="">{cfg.groqModel} (default)</option>
                    {groqModels.filter((m) => m !== cfg.groqModel).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </td>
                <td className="py-2 text-muted-foreground">{cfg.targetMs < 1000 ? `${cfg.targetMs} ms` : `${cfg.targetMs / 1000} s`}</td>
                <td className="py-2 text-right"><Toggle on={!ks[name]} onClick={() => patch({ killSwitches: { ...ks, [name]: !ks[name] } }, name)} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>

      <section className="mt-8 card p-6">
        <h2 className="text-[20px] font-semibold">Assumptions in the seed</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Values with no public source. Everything else traces to research/ (R1–R5).</p>
        <div className="-mx-2 overflow-x-auto px-2"><table className="mt-3 w-full text-[13px]">
          <tbody>
            {a.seed.assumptions.map((x) => (
              <tr key={x.key} className="border-t border-border/60 align-top">
                <td className="w-48 py-2 font-medium">{x.key}</td>
                <td className="py-2">{x.value}</td>
                <td className="w-[40%] py-2 text-muted-foreground">{x.why}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </main>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} role="switch" aria-checked={on} className={cn("relative inline-flex h-6 w-10 items-center rounded-full transition-colors", on ? "bg-seal-green" : "bg-[#d2d2d7]")}>
      <span className={cn("absolute size-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}
