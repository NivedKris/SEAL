"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ExternalLink } from "lucide-react";
import { CONCEPT_TEXT } from "@/lib/rules/concepts";
import { CodeCard, CodeChip, useCodeInfo } from "@/components/shared/code-chip";
import { cn } from "@/lib/utils";
import type { CheckState, Detail, Ev, Hit } from "./claim-detail";

/**
 * SEAL TRACE — every step of the decision on one screen, like a market terminal: what SEAL read,
 * which codes it weighed, which rules and past claims it leaned on, what each AI said, and why the
 * claim was held or released. Click any node to see its evidence and its source.
 */
type NodeKind = "note" | "dx" | "line" | "hit" | "past" | "hospital" | "judge" | "critic" | "decision";
type Tone = "idle" | "live" | "ok" | "warn" | "bad";
type GNode = { id: string; kind: NodeKind; col: number; title: string; sub: string; tone: Tone; ref?: string };
type GEdge = { from: string; to: string; tone: Tone };

const COLS = ["READ", "CODES", "CHECKS", "AI", "DECISION"];
const COL_X = [90, 300, 520, 730, 910];
const NODE_W = 160;
const NODE_H = 46;
const GAP = 16;
const TONE: Record<Tone, { stroke: string; fill: string; text: string }> = {
  idle: { stroke: "rgba(31,43,41,0.16)", fill: "rgba(255,255,255,0.45)", text: "rgba(31,43,41,0.4)" },
  live: { stroke: "#2f9e62", fill: "rgba(191,240,214,0.45)", text: "#2f9e62" },
  ok: { stroke: "rgba(47,158,98,0.55)", fill: "rgba(191,240,214,0.35)", text: "#237a4b" },
  warn: { stroke: "rgba(201,138,26,0.65)", fill: "rgba(255,226,170,0.4)", text: "#a86f0e" },
  bad: { stroke: "rgba(194,71,60,0.7)", fill: "rgba(255,214,208,0.45)", text: "#b23b31" },
};
const pct = (p?: number | null) => (p == null ? "--" : `${Math.round(p * 100)}%`);
const riskTone = (p?: number | null): Tone => (p == null ? "idle" : p >= 0.6 ? "bad" : p >= 0.3 ? "warn" : "ok");
const ms = (v?: number) => (v == null ? "" : v < 1000 ? `${v}ms` : `${(v / 1000).toFixed(1)}s`);

function build(detail: Detail, check: CheckState, running: boolean) {
  const lines = detail.claim.versions.at(-1)!.lines;
  const ruleLines = (check.routed?.lines as { activityId: string; hits: Hit[] }[] | undefined) ?? check.rules?.lines ?? [];
  const lineRisk = check.routed?.lineRisk ?? Object.fromEntries((check.judge?.lines ?? []).map((l) => [l.activityId, l.probability]));
  const quotes = (check.judge?.documentation ?? []).filter((a) => a.documented && a.evidence);
  const gaps = (check.judge?.documentation ?? []).filter((a) => !a.documented);
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];

  // READ
  nodes.push({ id: "note", kind: "note", col: 0, title: "DOCTOR'S NOTE", sub: check.judge ? `${quotes.length} proofs · ${gaps.length} gaps` : `${detail.encounter.findings.split(/\s+/).length} words`, tone: check.judge ? (gaps.length ? "warn" : "ok") : "ok" });
  detail.diagnoses.slice(0, 4).forEach((d) => nodes.push({ id: `dx:${d.icd10}`, kind: "dx", col: 0, title: d.icd10, sub: d.primary ? "main diagnosis" : "other diagnosis", tone: "ok", ref: d.icd10 }));

  // CODES
  lines.slice(0, 7).forEach((l) => {
    const hits = ruleLines.find((r) => r.activityId === l.activityId)?.hits ?? [];
    const p = lineRisk[l.activityId];
    nodes.push({ id: `line:${l.activityId}`, kind: "line", col: 1, title: l.code, sub: `AED ${l.net.toFixed(0)} · risk ${pct(p)}`, tone: hits.some((h) => h.fired === true) ? "bad" : p != null ? riskTone(p) : "ok", ref: l.activityId });
    detail.diagnoses.slice(0, 4).forEach((d) => edges.push({ from: `dx:${d.icd10}`, to: `line:${l.activityId}`, tone: d.primary ? "ok" : "idle" }));
  });

  // CHECKS
  // Every rule the first pass flagged; ones the routed result no longer carries were cleared (proof found).
  const flagged = check.rules?.lines ?? ruleLines;
  const kept = new Set(ruleLines.flatMap((rl) => rl.hits.map((h) => `${rl.activityId}|${h.ruleId}`)));
  const hitMap = new Map<string, { hit: Hit; lines: string[]; cleared: boolean }>();
  for (const rl of flagged)
    for (const h of rl.hits) {
      const prev = hitMap.get(h.ruleId);
      const cleared = !!check.routed && !kept.has(`${rl.activityId}|${h.ruleId}`);
      hitMap.set(h.ruleId, { hit: h, lines: [...(prev?.lines ?? []), rl.activityId], cleared: (prev?.cleared ?? true) && cleared });
    }
  if (!check.rules) nodes.push({ id: "rules", kind: "hit", col: 2, title: "INSURER RULES", sub: running ? "checking…" : "waiting", tone: running ? "live" : "idle" });
  else if (!hitMap.size) nodes.push({ id: "rules", kind: "hit", col: 2, title: "INSURER RULES", sub: "nothing broken", tone: "ok" });
  [...hitMap.values()].slice(0, 5).forEach(({ hit, lines: ls, cleared }) => {
    const id = `hit:${hit.ruleId}`;
    const tone: Tone = cleared ? "ok" : hit.fired === true ? "bad" : "warn";
    nodes.push({ id, kind: "hit", col: 2, title: hit.denialCode, sub: cleared ? "proof found · cleared" : hit.fired === true ? "rule broken" : "needs proof", tone, ref: hit.ruleId });
    ls.forEach((a) => edges.push({ from: `line:${a}`, to: id, tone }));
  });
  if (nodes.some((n) => n.id === "rules")) lines.slice(0, 7).forEach((l) => edges.push({ from: `line:${l.activityId}`, to: "rules", tone: check.rules ? "ok" : "idle" }));
  const sim = check.retrieval?.similar ?? [];
  const simRefused = sim.filter((s) => s.firstPassRefused).length;
  const own = sim.filter((s) => s.hospital).length;
  nodes.push({ id: "past", kind: "past", col: 2, title: "PAST CLAIMS", sub: check.retrieval ? `${sim.length} alike${own ? ` · ${own} ours` : ""} · ${simRefused} refused` : running ? "searching…" : "waiting", tone: !check.retrieval ? (running && check.rules ? "live" : "idle") : simRefused / Math.max(1, sim.length) >= 0.4 ? "warn" : "ok" });
  lines.slice(0, 7).forEach((l) => edges.push({ from: `line:${l.activityId}`, to: "past", tone: check.retrieval ? "ok" : "idle" }));
  // This hospital's own history with this insurer (hospitals with their own data only)
  const h = check.hospital;
  if (h) {
    const tone: Tone = h.factor >= 1.15 ? "warn" : h.factor <= 0.9 ? "ok" : "ok";
    nodes.push({ id: "hospital", kind: "hospital", col: 2, title: "HOSPITAL HISTORY", sub: `${h.insurer.split(" ")[0]} ×${h.factor.toFixed(2)} risk`, tone });
    edges.push({ from: "hospital", to: "decision", tone: check.routed ? tone : "idle" });
  }

  // AI
  const j = check.judge;
  const jp = j?.claimProbability ?? check.routed?.riskScore;
  nodes.push({ id: "judge", kind: "judge", col: 3, title: "AI REVIEW", sub: j ? (j.error ? "paused · rules only" : `refusal ${pct(jp)}`) : running && check.retrieval ? "reading…" : "waiting", tone: j ? (j.error ? "warn" : riskTone(jp)) : running && check.retrieval ? "live" : "idle" });
  const cr = check.critic;
  nodes.push({ id: "critic", kind: "critic", col: 3, title: "SECOND OPINION", sub: cr ? (cr.error ? "unavailable" : cr.verdict === "pass" && cr.agreement === "agree" ? "agrees" : "asks for review") : check.routed ? "not needed" : running && j ? "double-checking…" : "waiting", tone: cr ? (cr.error ? "warn" : cr.verdict === "pass" && cr.agreement === "agree" ? "ok" : "warn") : check.routed ? "ok" : running && j ? "live" : "idle" });
  edges.push({ from: "note", to: "judge", tone: j ? "ok" : "idle" }, { from: "past", to: "judge", tone: j ? "ok" : "idle" }, { from: "judge", to: "critic", tone: cr ? "ok" : "idle" });
  nodes.filter((n) => n.kind === "hit").forEach((n) => edges.push({ from: n.id, to: "judge", tone: j ? n.tone : "idle" }));

  // DECISION
  const r = check.routed;
  nodes.push({ id: "decision", kind: "decision", col: 4, title: r ? (r.route === "hold" ? "HOLD" : "READY") : "DECIDING", sub: r ? `risk ${pct(r.riskScore)} · ${ms(r.ms)}` : running ? "…" : "not checked", tone: r ? (r.route === "hold" ? "bad" : "ok") : running ? "live" : "idle" });
  edges.push({ from: "judge", to: "decision", tone: r ? "ok" : "idle" }, { from: "critic", to: "decision", tone: r ? "ok" : "idle" });
  nodes.filter((n) => n.kind === "hit" && n.tone === "bad").forEach((n) => edges.push({ from: n.id, to: "decision", tone: r ? "bad" : "idle" }));

  // layout: centre each column vertically
  const perCol = COLS.map((_, c) => nodes.filter((n) => n.col === c));
  const tallest = Math.max(...perCol.map((xs) => xs.length));
  const height = Math.max(300, tallest * (NODE_H + GAP) + 60);
  const pos = new Map<string, { x: number; y: number }>();
  perCol.forEach((xs, c) => {
    const total = xs.length * NODE_H + (xs.length - 1) * GAP;
    xs.forEach((n, i) => pos.set(n.id, { x: COL_X[c], y: 40 + (height - 40 - total) / 2 + i * (NODE_H + GAP) }));
  });
  return { nodes, edges, pos, height };
}

export function TraceTerminal({ detail, check, running, events }: { detail: Detail; check: CheckState; running: boolean; events: Ev[] }) {
  const { nodes, edges, pos, height } = useMemo(() => build(detail, check, running), [detail, check, running]);
  const [sel, setSel] = useState<string>("decision");
  const selected = nodes.find((n) => n.id === sel) ?? nodes.at(-1)!;
  const c = detail.claim;
  const lines = c.versions.at(-1)!.lines;
  const model = check.judge?.model ?? check.critic?.model;

  // the edges touching the selected node are lit; the rest dim
  const touches = (e: GEdge) => e.from === selected.id || e.to === selected.id;

  return (
    <section className="card relative mt-8 overflow-hidden !rounded-[28px] !p-0 text-ink">
      <div className="led-grid pointer-events-none absolute inset-0 opacity-50" />
      <div className="scanlines pointer-events-none absolute inset-0" />

      {/* Quote board */}
      <div className="relative grid grid-cols-2 border-b border-ink/10 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["CLAIM", c.claimNo.split("-").at(-1) ?? c.claimNo, ""],
          ["INSURER", detail.payer.name.split(" ")[0].toUpperCase(), ""],
          ["VALUE AED", c.net.toLocaleString("en", { maximumFractionDigits: 0 }), ""],
          ["REFUSAL RISK", pct(check.routed?.riskScore ?? c.riskScore), riskTone(check.routed?.riskScore ?? c.riskScore)],
          ["ROUTE", check.routed ? check.routed.route.toUpperCase() : running ? "LIVE" : "--", check.routed ? (check.routed.route === "hold" ? "bad" : "ok") : running ? "live" : ""],
          ["TIME", check.routed ? ms(check.routed.ms) : "--", ""],
        ].map(([k, v, t]) => (
          <div key={k} className="border-b border-r border-ink/[0.07] px-4 py-3 lg:border-b-0">
            <div className="font-mono text-[10px] tracking-[0.18em] text-ink/40">{k}</div>
            <div className="dot mt-1 truncate text-[22px] leading-none md:text-[26px]" style={{ color: t ? TONE[t as Tone].text : "#1f2b29" }}>
              {v}
            </div>
          </div>
        ))}
      </div>

      {/* Ticker of this claim's codes */}
      <div className="relative overflow-hidden border-b border-ink/10 bg-seal-mint/25 py-1.5">
        <div className="ticker flex w-max gap-8 whitespace-nowrap font-mono text-[12px]">
          {[0, 1].map((k) => (
            <div key={k} className="flex gap-8">
              {lines.map((l) => {
                const p = check.routed?.lineRisk?.[l.activityId];
                return (
                  <span key={l.activityId} className="text-ink/60">
                    <span className="text-ink">{l.code}</span> {l.label.slice(0, 28)} <span style={{ color: TONE[riskTone(p)].text }}>{p == null ? "·" : p >= 0.3 ? "▲" : "▼"} {pct(p)}</span>
                  </span>
                );
              })}
              {detail.diagnoses.map((d) => (
                <span key={d.icd10} className="text-ink/60">
                  <span className="text-seal-deep">{d.icd10}</span> {d.description?.slice(0, 32)}
                </span>
              ))}
              {model && <span className="text-ink/40">MODEL {model}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="relative grid grid-cols-1 xl:grid-cols-[1fr_360px]">
        {/* Graph */}
        <div className="min-w-0 border-b border-ink/10 xl:border-b-0 xl:border-r">
          <div className="flex items-center justify-between px-5 pt-4">
            <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.2em] text-seal-deep">
              <span className={cn("size-1.5 rounded-full bg-seal-deep", running && "trace-pulse")} /> SEAL TRACE
            </div>
            <span className="font-mono text-[11px] text-ink/35">tap any step to see why</span>
          </div>
          {/* Phones: the same steps as a vertical rail */}
          <div className="space-y-4 px-5 pb-4 pt-3 md:hidden">
            {COLS.map((label, ci) => (
              <div key={label}>
                <div className="dot text-[12px] text-ink/35">{label}</div>
                <div className="mt-1.5 flex flex-wrap gap-2 border-l border-ink/10 pl-3">
                  {nodes
                    .filter((n) => n.col === ci)
                    .map((n) => (
                      <button key={n.id} onClick={() => setSel(n.id)} className={cn("rounded-xl px-3 py-2 text-left ring-1", n.id === selected.id && "ring-2", n.tone === "live" && "trace-pulse")} style={{ background: TONE[n.tone].fill, borderColor: TONE[n.tone].stroke, boxShadow: `inset 0 0 0 1px ${TONE[n.tone].stroke}` }}>
                        <div className="dot text-[15px]" style={{ color: TONE[n.tone].text }}>
                          {n.title}
                        </div>
                        <div className="font-mono text-[10px] text-ink/50">{n.sub}</div>
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto px-2 pb-3 md:block">
            <svg viewBox={`0 0 1000 ${height}`} className="min-w-[820px]" style={{ width: "100%", height: "auto" }}>
              {COLS.map((label, i) => (
                <text key={label} x={COL_X[i]} y={22} textAnchor="middle" className="dot" fontSize={13} fill="rgba(31,43,41,0.4)">
                  {label}
                </text>
              ))}
              {edges.map((e, i) => {
                const a = pos.get(e.from);
                const b = pos.get(e.to);
                if (!a || !b) return null;
                const x1 = a.x + NODE_W / 2;
                const y1 = a.y + NODE_H / 2;
                const x2 = b.x - NODE_W / 2;
                const y2 = b.y + NODE_H / 2;
                const mx = (x1 + x2) / 2;
                const lit = touches(e);
                const flowing = running && e.tone === "idle";
                return (
                  <path
                    key={i}
                    d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                    fill="none"
                    stroke={flowing ? TONE.live.stroke : TONE[e.tone].stroke}
                    strokeOpacity={lit ? 1 : selected ? 0.35 : 0.7}
                    strokeWidth={lit ? 2 : 1.2}
                    className={cn((flowing || lit) && "trace-flow")}
                  />
                );
              })}
              {nodes.map((n) => {
                const p = pos.get(n.id)!;
                const t = TONE[n.tone];
                const on = n.id === selected.id;
                return (
                  <g key={n.id} transform={`translate(${p.x - NODE_W / 2},${p.y})`} onClick={() => setSel(n.id)} className="cursor-pointer">
                    {on && <rect x={-4} y={-4} width={NODE_W + 8} height={NODE_H + 8} rx={14} fill="none" stroke={t.stroke} strokeOpacity={0.5} className="trace-pulse" />}
                    <rect width={NODE_W} height={NODE_H} rx={11} fill={t.fill} stroke={t.stroke} strokeWidth={on ? 2 : 1} className={cn(n.tone === "live" && "trace-pulse")} />
                    <text x={12} y={20} className="dot" fontSize={15} fill={t.text}>
                      {n.title.length > 16 ? n.title.slice(0, 15) + "…" : n.title}
                    </text>
                    <text x={12} y={36} fontSize={10.5} fontFamily="var(--font-geist-mono)" fill="rgba(31,43,41,0.55)">
                      {n.sub}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Inspector */}
        <div className="min-h-[300px] p-5">
          <AnimatePresence mode="wait">
            <motion.div key={selected.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
              <Inspector node={selected} detail={detail} check={check} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <Tape events={events} />
    </section>
  );
}

// ── Inspector: the "why" behind the selected step ─────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[10px] tracking-[0.2em] text-ink/40">{children}</div>;
}

function Inspector({ node, detail, check }: { node: GNode; detail: Detail; check: CheckState }) {
  const lines = detail.claim.versions.at(-1)!.lines;
  const ruleLines = (check.routed?.lines as { activityId: string; hits: Hit[] }[] | undefined) ?? check.rules?.lines ?? [];

  if (node.kind === "dx") return <CodeInspector code={node.ref!} note={detail.diagnoses.find((d) => d.icd10 === node.ref)?.primary ? "The main reason for the visit. Every service on the claim must make sense for it." : "Also recorded for this visit."} />;

  if (node.kind === "line") {
    const l = lines.find((x) => x.activityId === node.ref)!;
    const hits = ruleLines.find((r) => r.activityId === l.activityId)?.hits ?? [];
    const why = check.judge?.lines?.find((x) => x.activityId === l.activityId)?.reasons ?? [];
    return (
      <div className="space-y-4">
        <CodeInspector code={l.code} />
        <div className="grid grid-cols-2 gap-2">
          <Stat k="CHARGED" v={`AED ${l.net.toLocaleString()}`} />
          <Stat k="REFUSAL RISK" v={pct(check.routed?.lineRisk?.[l.activityId])} tone={riskTone(check.routed?.lineRisk?.[l.activityId])} />
        </div>
        {hits.length > 0 && (
          <div>
            <Label>RULES TOUCHING THIS LINE</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {hits.map((h) => (
                <CodeChip key={h.ruleId} code={h.denialCode} dark />
              ))}
            </div>
          </div>
        )}
        {why.length > 0 && <Reasons reasons={why} />}
      </div>
    );
  }

  if (node.kind === "hit") {
    if (node.id === "rules") return <Plain title="Insurer rules" text={check.rules ? `Checked ${lines.length} lines against this insurer's approval, limit, duplicate and medical-need rules. Nothing is broken.` : "Waiting for the check to start."} />;
    const h = [...ruleLines, ...(check.rules?.lines ?? [])].flatMap((r) => r.hits).find((x) => x.ruleId === node.ref)!;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <CodeChip code={h.denialCode} dark />
          <span className={cn("rounded-full px-2 py-0.5 font-mono text-[10px]", node.tone === "ok" ? "bg-seal-deep/15 text-seal-deep" : h.fired === true ? "bg-[#c2473c]/10 text-[#b23b31]" : "bg-seal-amber/15 text-[#a86f0e]")}>{node.tone === "ok" ? "CLEARED · PROOF IN NOTE" : h.fired === true ? "BROKEN" : "NEEDS PROOF"}</span>
        </div>
        <h3 className="text-[18px] font-semibold leading-snug">{h.title}</h3>
        <div>
          <Label>THE INSURER NEEDS</Label>
          <p className="mt-1 text-[14px] leading-relaxed text-ink/80">{h.insurerNeeds}</p>
        </div>
        {h.missing.length > 0 && (
          <div>
            <Label>NOT FOUND IN THE NOTE</Label>
            <ul className="mt-1 space-y-1 text-[14px] text-ink/75">
              {h.missing.map((m) => (
                <li key={m}>— {CONCEPT_TEXT[m]}</li>
              ))}
            </ul>
          </div>
        )}
        {h.fixActions.length > 0 && (
          <div>
            <Label>HOW TO FIX</Label>
            <ul className="mt-1 space-y-1 text-[14px] text-ink/75">
              {h.fixActions.map((m) => (
                <li key={m}>→ {m}</li>
              ))}
            </ul>
          </div>
        )}
        <Source s={h.source} verified={h.verified} id={h.ruleId} />
      </div>
    );
  }

  if (node.kind === "past") {
    const sim = check.retrieval?.similar ?? [];
    if (!sim.length) return <Plain title="Past claims" text="SEAL searches its memory of earlier claims to this insurer with the same services and diagnoses." />;
    const ownList = sim.filter((s) => s.hospital);
    const regional = sim.filter((s) => !s.hospital);
    const Row = ({ s }: { s: (typeof sim)[number] }) => (
      <div className="rounded-xl bg-white/60 px-3 py-2 ring-1 ring-ink/[0.06]">
        <div className="flex items-center justify-between">
          <span className="truncate font-mono text-[11px] text-ink/50">{s.hospital ? `${s.clinician ?? ""} · AED ${Math.round(s.value ?? 0)}` : s.claimId.slice(-10)}</span>
          <span className={cn("dot text-[14px]", s.firstPassRefused ? "text-[#b23b31]" : "text-seal-deep")}>{s.firstPassRefused ? "REFUSED" : "PAID"}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/[0.08]">
            <div className="h-full bg-seal-deep" style={{ width: `${Math.round(s.score * 100)}%` }} />
          </div>
          <span className="font-mono text-[10px] text-ink/40">{Math.round(s.score * 100)}% alike</span>
        </div>
        {s.refused.length > 0 && <p className="mt-1 text-[12px] text-ink/60">{s.refused[0]}</p>}
        {s.fixes.length > 0 && <p className="mt-0.5 text-[12px] text-seal-deep/80">{s.hospital ? s.fixes[0] : `Fixed by: ${s.fixes[0]}`}</p>}
      </div>
    );
    return (
      <div className="space-y-4">
        {ownList.length > 0 && (
          <div>
            <Label>{ownList[0].hospital!.toUpperCase()}&apos;S OWN CLAIMS · SAME INSURER</Label>
            <div className="mt-2 space-y-2">
              {ownList.map((s) => (
                <Row key={s.claimId} s={s} />
              ))}
            </div>
          </div>
        )}
        <div>
          <Label>{ownList.length ? "REGIONAL MEMORY" : "MOST ALIKE · THIS INSURER"}</Label>
          <div className="mt-2 space-y-2">
            {regional.slice(0, ownList.length ? 4 : 6).map((s) => (
              <Row key={s.claimId} s={s} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (node.kind === "note") {
    const docs = check.judge?.documentation ?? [];
    return (
      <div className="space-y-3">
        <Label>WHAT SEAL FOUND IN THE NOTE</Label>
        {!docs.length && <p className="text-[14px] text-ink/60">{detail.encounter.complaint}</p>}
        {docs.slice(0, 6).map((a, i) => (
          <div key={i} className={cn("rounded-xl px-3 py-2 text-[13px] ring-1", a.documented ? "bg-seal-deep/[0.06] ring-seal-green/20" : "bg-seal-amber/10 ring-seal-amber/25")}>
            <div className={cn("font-mono text-[10px] tracking-[0.12em]", a.documented ? "text-seal-deep" : "text-[#a86f0e]")}>{a.documented ? "✓ PROVEN" : "✗ MISSING"} · {CONCEPT_TEXT[a.concept]}</div>
            {a.evidence && <p className="mt-1 italic text-ink/75">“{a.evidence}”</p>}
          </div>
        ))}
      </div>
    );
  }

  if (node.kind === "judge") {
    const j = check.judge;
    if (!j) return <Plain title="AI review" text="Reads the doctor's note together with the insurer's rules and the past claims, and gives each line a chance of refusal." />;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Stat k="REFUSAL CHANCE" v={pct(j.claimProbability ?? check.routed?.riskScore)} tone={riskTone(j.claimProbability ?? check.routed?.riskScore)} />
          <Stat k="CONFIDENCE" v={(j.confidence ?? "--").toUpperCase()} />
        </div>
        {j.summary && <p className="text-[14px] leading-relaxed text-ink/80">{j.summary}</p>}
        {j.lines?.flatMap((l) => l.reasons).length ? <Reasons reasons={j.lines.flatMap((l) => l.reasons).slice(0, 5)} /> : null}
        <Machine model={j.model} provider={j.provider} latency={j.latencyMs ?? j.ms} fallback={j.fallbackUsed} />
      </div>
    );
  }

  if (node.kind === "critic") {
    const cr = check.critic;
    if (!cr) return <Plain title="Second opinion" text={check.routed ? "Not needed: the claim was low risk and no rule was in doubt, so SEAL did not ask a second AI." : "A second, independent AI checks the first one's reasoning. If they disagree, a person decides."} />;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Stat k="VERDICT" v={(cr.verdict ?? "--").toUpperCase()} tone={cr.verdict === "pass" ? "ok" : "warn"} />
          <Stat k="AGREEMENT" v={(cr.agreement ?? "--").replace("_", " ").toUpperCase()} tone={cr.agreement === "agree" ? "ok" : "warn"} />
        </div>
        {cr.note && <p className="text-[14px] text-ink/80">{cr.note}</p>}
        {cr.issues?.map((i, k) => (
          <p key={k} className="rounded-xl bg-white/60 px-3 py-2 text-[13px] text-ink/75">{i.detail}</p>
        ))}
        <Machine model={cr.model} provider={cr.provider} latency={cr.latencyMs ?? cr.ms} fallback={cr.fallbackUsed} />
      </div>
    );
  }

  const r = check.routed;
  if (!r) return <Plain title="Decision" text="Once every step is in, SEAL either releases the claim to the insurer or holds it with a clear list of what to fix." />;
  return (
    <div className="space-y-4">
      <div className={cn("dot text-[54px] leading-none", r.route === "hold" ? "text-[#b23b31]" : "text-seal-deep")}>{r.route === "hold" ? "HOLD" : "READY"}</div>
      <div className="grid grid-cols-2 gap-2">
        <Stat k="REFUSAL RISK" v={pct(r.riskScore)} tone={riskTone(r.riskScore)} />
        <Stat k="DECIDED IN" v={ms(r.ms)} />
      </div>
      <div>
        <Label>BECAUSE</Label>
        <ul className="mt-1 space-y-1.5 text-[14px] text-ink/80">
          {r.holdReasons.length ? r.holdReasons.map((x) => <li key={x}>→ {x.replace(/^(Fix needed|Documentation gap): /, "")}</li>) : <li>→ No rule is broken and similar claims were paid.</li>}
        </ul>
      </div>
    </div>
  );
}

function CodeInspector({ code, note }: { code: string; note?: string }) {
  const info = useCodeInfo(code);
  return (
    <div className="space-y-3">
      <div className="[&>div]:w-full [&>div]:bg-white/60 [&>div]:shadow-none">
        <CodeCard info={info} code={code} />
      </div>
      {note && <p className="text-[13px] text-ink/60">{note}</p>}
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: Tone }) {
  return (
    <div className="rounded-xl bg-white/60 px-3 py-2 ring-1 ring-ink/[0.06]">
      <Label>{k}</Label>
      <div className="dot mt-0.5 text-[22px]" style={{ color: tone ? TONE[tone].text : "#1f2b29" }}>
        {v}
      </div>
    </div>
  );
}

function Reasons({ reasons }: { reasons: { text: string; ruleId?: string; pastClaimIds?: string[] }[] }) {
  return (
    <div>
      <Label>AI REASONING</Label>
      <ol className="mt-1 space-y-1.5">
        {reasons.map((r, i) => (
          <li key={i} className="flex gap-2 text-[13px] text-ink/80">
            <span className="dot text-seal-deep">{String(i + 1).padStart(2, "0")}</span>
            <span>
              {r.text}
              {(r.ruleId || r.pastClaimIds?.length) && (
                <span className="ml-1 font-mono text-[10px] text-ink/40">
                  [{[r.ruleId, ...(r.pastClaimIds ?? []).slice(0, 2).map((x) => x.slice(-8))].filter(Boolean).join(" · ")}]
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Source({ s, verified, id }: { s: Hit["source"]; verified: boolean; id: string }) {
  return (
    <a href={s.url} target="_blank" rel="noreferrer" className="block rounded-xl bg-white/60 px-3 py-2.5 ring-1 ring-ink/[0.06] hover:ring-seal-deep/40">
      <Label>SOURCE · {verified ? "VERIFIED" : "TO CONFIRM"} · {id}</Label>
      <div className="mt-1 flex items-start gap-1.5 text-[13px] text-ink/80">
        <span className="flex-1">
          {s.publisher} — {s.title}
        </span>
        <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-ink/40" />
      </div>
    </a>
  );
}

function Machine({ model, provider, latency, fallback }: { model?: string; provider?: string; latency?: number; fallback?: boolean }) {
  if (!model) return null;
  return (
    <p className="font-mono text-[10px] tracking-[0.1em] text-ink/35">
      {provider?.toUpperCase()} · {model} · {ms(latency)}
      {fallback ? " · BACKUP MODEL" : ""}
    </p>
  );
}

function Plain({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <Label>{title.toUpperCase()}</Label>
      <p className="mt-2 text-[14px] leading-relaxed text-ink/70">{text}</p>
    </div>
  );
}

// ── Tape: the audit trail, newest first ───────────────────────────────────────
const TAPE: Record<string, [string, string]> = {
  "claim.created": ["NEW", "#2a78d6"],
  "claim.check.started": ["CHECK", "#2f9e62"],
  "claim.check.rule_result": ["RULES", "#2f9e62"],
  "claim.check.ai_result": ["AI", "#237a4b"],
  "claim.held": ["HOLD", "#b23b31"],
  "claim.ready": ["READY", "#237a4b"],
  "claim.submitted": ["SENT", "#2a78d6"],
  "questions.created": ["ASK", "#a86f0e"],
  "addendum.attached": ["NOTE+", "#a86f0e"],
  "remittance.received": ["PAID", "#237a4b"],
};
function tapeText(e: Ev): string {
  if (e.type === "claim.check.ai_result") return `${String(e.stage ?? "").toUpperCase()}${e.ms ? ` in ${ms(e.ms as number)}` : ""}${e.route ? ` → ${String(e.route).toUpperCase()}` : ""}`;
  if (e.type === "claim.check.rule_result") return `${(e.lines as { hits: unknown[] }[] | undefined)?.reduce((n, l) => n + l.hits.length, 0) ?? 0} rule hits in ${ms(e.ms as number)}`;
  if (e.type === "claim.check.started") return `run ${e.run}`;
  return e.type.split(".").slice(1).join(" ");
}

function Tape({ events }: { events: Ev[] }) {
  const xs = events.slice(-14).reverse();
  if (!xs.length) return null;
  return (
    <div className="relative border-t border-ink/10 px-5 py-3">
      <Label>AUDIT TAPE</Label>
      <div className="mt-2 max-h-[150px] space-y-0.5 overflow-y-auto font-mono text-[12px]">
        {xs.map((e, i) => {
          const [tag, color] = TAPE[e.type] ?? [e.type.split(".")[0].toUpperCase().slice(0, 6), "rgba(255,255,255,0.5)"];
          return (
            <motion.div key={e.seq} initial={i === 0 ? { opacity: 0, x: -6 } : false} animate={{ opacity: 1, x: 0 }} className="flex gap-3 whitespace-nowrap">
              <span className="text-ink/35">{new Date(e.at).toLocaleTimeString("en-GB", { timeZone: "Asia/Dubai" })}</span>
              <span className="w-12 shrink-0" style={{ color }}>
                {tag}
              </span>
              <span className={cn("truncate text-ink/70", i === 0 && "caret")}>{tapeText(e)}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
