"use client";

import { SealLoader } from "@/components/brand/seal-loader";
import { useCallback, useEffect, useRef, useState } from "react";
import { useData } from "@/lib/client/data";
import { useSearchParams } from "next/navigation";
import { PAGE_EVENT, setAssistantPage, type PageEvent, useAssistantScreen } from "@/components/assistant/store";
import { ArrowLeft, Check, ChevronRight, Loader2 } from "lucide-react";
import { SealLogo } from "@/components/brand/seal-logo";
import { cn } from "@/lib/utils";

type Field = { key: string; kind: "number" | "choice" | "text" | "date"; labelEn: string; labelAr: string; options?: string[]; unit?: string };
type Question = { gapId: string; order?: string; textEn: string; textAr: string; insurerNeeds: string; fields: Field[]; answer?: Record<string, string | number> };
type SetRow = { _id: string; claimId: string; providerId: string; questions: Question[]; patientName?: string; visitAt?: string; theme?: string; scenario?: string; providerName?: string; status: string };
type Detail = { set: SetRow; patient: { name: string; sex: string } | null; visitAt?: string; claim: { claimNo: string } | null; payer: { name: string } | null };

const T = {
  en: { questions: "Questions", none: "Nothing waiting. Questions from your claims appear here within seconds.", q: (n: number) => `${n} question${n === 1 ? "" : "s"}`, of: (i: number, n: number) => `${i} of ${n}`, why: "Why the insurer asks", back: "Back", next: "Next", review: "Review addendum", confirm: "This is exactly what will be added to the record and attached to the claim, in your words.", sign: "Sign and attach", done: "Attached", doneBody: (c: string) => `Your addendum is on the record and on claim ${c}. SEAL is re-checking the claim now.`, inbox: "Back to inbox", all: "All doctors", saved: "Saved", saving: "Saving…" },
  ar: { questions: "الأسئلة", none: "لا يوجد شيء بانتظارك. تظهر أسئلة مطالباتك هنا خلال ثوانٍ.", q: (n: number) => `${n} ${n === 1 ? "سؤال" : "أسئلة"}`, of: (i: number, n: number) => `${i} من ${n}`, why: "لماذا تطلب شركة التأمين ذلك", back: "رجوع", next: "التالي", review: "مراجعة الملحق", confirm: "هذا بالضبط ما سيُضاف إلى السجل ويُرفق بالمطالبة، بكلماتك.", sign: "توقيع وإرفاق", done: "تم الإرفاق", doneBody: (c: string) => `أُضيف ملحقك إلى السجل وإلى المطالبة ${c}. يعيد SEAL فحص المطالبة الآن.`, inbox: "العودة إلى البريد", all: "جميع الأطباء", saved: "تم الحفظ", saving: "جارٍ الحفظ…" },
};

const initials = (n?: string) => (n ?? "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const time = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }) : "");

export function DoctorApp() {
  const [lang, setLang] = useState<"en" | "ar">("en");
  const t = T[lang];
  const params = useSearchParams();
  // Opened from a doctor's card on Today: start on that doctor's questions.
  const [providerId, setProviderId] = useState(params.get("providerId") ?? "");

  const [open, setOpen] = useState<string | null>(params.get("q"));
  // The assistant (or a link) can change the doctor or open a question set while this screen is open.
  const urlDoctor = params.get("providerId");
  const urlSet = params.get("q");
  useEffect(() => {
    if (urlDoctor !== null) setProviderId(urlDoctor);
  }, [urlDoctor]);
  useEffect(() => {
    if (urlSet) setOpen(urlSet);
  }, [urlSet]);
  const cursor = useRef(0);
  const lastProviders = useRef<{ _id: string; name: string }[]>([]);

  const q = useData<{ sets: SetRow[]; providers: { _id: string; name: string }[] }>(`/api/questions?status=open${providerId ? `&providerId=${providerId}` : ""}`);
  const sets = q.data?.sets ?? null;
  const providers = q.data?.providers ?? lastProviders.current;
  if (q.data?.providers) lastProviders.current = q.data.providers;
  const reload = q.reload;
  useAssistantScreen(sets && { title: "Questions for doctors", items: sets.slice(0, 40).map((x) => ({ id: x._id, kind: "questions", label: `${x.patientName ?? ""} · ${x.providerName ?? ""} · ${x.questions.length} question${x.questions.length === 1 ? "" : "s"}` })) });
  const load = useCallback(() => reload().catch(() => {}), [reload]);
  // Watch for new questions: poll domain events every 1.5 s (plan §6).
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/events?since=${cursor.current}`).then((x) => x.json());
        if (cursor.current > 0 && r.events?.some((e: { type: string }) => e.type === "questions.created" || e.type === "addendum.attached")) void load();
        cursor.current = r.cursor ?? cursor.current;
      } catch {}
      if (!stop) setTimeout(tick, 1500);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [load]);

  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} className="min-h-full">
      <header className="glass sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border/60 px-5 pb-3 pt-14 max-[430px]:pt-4">
        <SealLogo height={20} />
        <div className="flex items-center gap-2">
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="max-w-[150px] rounded-full bg-secondary px-2.5 py-1 text-[12px] outline-none">
            <option value="">{t.all}</option>
            {providers.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
          <button onClick={() => setLang((l) => (l === "en" ? "ar" : "en"))} className="rounded-full bg-secondary px-2.5 py-1 text-[12px] font-medium">
            {lang === "en" ? "عربي" : "EN"}
          </button>
        </div>
      </header>
      {open ? (
        <QuestionFlow id={open} lang={lang} onClose={() => (setOpen(null), void load())} />
      ) : (
        <div className="px-5 py-6">
          <h1 className="text-[34px] font-bold leading-tight">{t.questions}</h1>
          {sets === null && <SealLoader size={28} />}
          {sets?.length === 0 && <p className="mt-2 text-[15px] text-muted-foreground">{t.none}</p>}
          <div className="mt-5 space-y-3">
            {sets?.map((s) => (
              <button key={s._id} onClick={() => setOpen(s._id)} className="flex w-full items-center gap-3.5 rounded-3xl bg-white px-4 py-4 text-start shadow-[0_8px_24px_-12px_rgba(0,0,0,0.2)] ring-1 ring-black/[0.05] transition-transform active:scale-[0.98]">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-[14px] font-semibold text-background">{initials(s.patientName)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[18px] font-semibold">{s.patientName}</div>
                  <div className="truncate text-[14px] text-muted-foreground">{time(s.visitAt)}</div>
                  <div className="mt-1 inline-flex rounded-full bg-foreground px-2.5 py-0.5 text-[12px] font-semibold text-background">{t.q(s.questions.length)}</div>
                </div>
                <ChevronRight className="size-5 text-muted-foreground rtl:rotate-180" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionFlow({ id, lang, onClose }: { id: string; lang: "en" | "ar"; onClose: () => void }) {
  const t = T[lang];
  const [d, setD] = useState<Detail | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Record<string, string | number>>>({});
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    fetch(`/api/questions/${id}`)
      .then((r) => r.json())
      .then((r: Detail) => {
        setD(r);
        setAnswers(Object.fromEntries(r.set.questions.map((q) => [q.gapId, q.answer ?? {}])));
      });
  }, [id]);

  // The assistant: tell it which questions are open, and show answers it fills in (already saved).
  const [glowKey, setGlowKey] = useState<string | null>(null);
  useEffect(() => {
    if (d) setAssistantPage({ questionSetId: id, kind: "questions", label: `SEAL's questions · ${d.patient?.name ?? "patient"}${d.claim ? ` · claim ${d.claim.claimNo.split("-").at(-1)}` : ""}` });
    return () => setAssistantPage({});
  }, [d, id]);
  useEffect(() => {
    const onEvent = (ev: Event) => {
      const e = (ev as CustomEvent<PageEvent>).detail;
      if (e.kind !== "answer" || e.setId !== id) return;
      setAnswers((a) => ({ ...a, [e.gapId]: { ...a[e.gapId], [e.key]: e.value } }));
      const i = d?.set.questions.findIndex((q) => q.gapId === e.gapId) ?? -1;
      if (i >= 0) setStep(i);
      setSaving("saved");
      setGlowKey(`${e.gapId}|${e.key}`);
      setTimeout(() => setGlowKey((g) => (g === `${e.gapId}|${e.key}` ? null : g)), 2400);
    };
    window.addEventListener(PAGE_EVENT, onEvent);
    return () => window.removeEventListener(PAGE_EVENT, onEvent);
  }, [d, id]);

  if (!d) return <SealLoader size={28} />;
  const qs = d.set.questions;
  const n = qs.length;

  const setField = (gapId: string, key: string, v: string | number) => {
    const next = { ...answers, [gapId]: { ...answers[gapId], [key]: v } };
    setAnswers(next);
    setSaving("saving");
    clearTimeout(timers.current[gapId]);
    // Answers save as the doctor fills them in.
    timers.current[gapId] = setTimeout(async () => {
      const r = await fetch(`/api/questions/${id}`, { method: "PATCH", headers: { "content-type": "application/json", "x-seal-user": d.set.providerId }, body: JSON.stringify({ gapId, answer: next[gapId] }) }).then((x) => x.json());
      if (r.error) setErr(r.error);
      else setErr(null);
      setSaving("saved");
    }, 400);
  };
  const complete = (q: Question) => q.fields.every((f) => answers[q.gapId]?.[f.key] !== undefined && answers[q.gapId]?.[f.key] !== "");

  const review = async () => {
    setBusy(true);
    await Promise.all(Object.values(timers.current).map(() => new Promise((r) => setTimeout(r, 450))));
    const r = await fetch(`/api/questions/${id}/preview`).then((x) => x.json());
    setPreview(r.text);
    setBusy(false);
  };
  const submit = async () => {
    setBusy(true);
    const r = await fetch(`/api/questions/${id}/submit`, { method: "POST", headers: { "x-seal-user": d.set.providerId } }).then((x) => x.json());
    setBusy(false);
    if (r.error) return setErr(r.error);
    setDone(true);
  };

  if (done)
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-risk-low text-white">
          <Check className="size-8" />
        </span>
        <h2 className="mt-5 text-[28px] font-bold">{t.done}</h2>
        <p className="mt-2 text-[15px] text-muted-foreground">{t.doneBody(d.claim?.claimNo ?? "")}</p>
        <button onClick={onClose} className="mt-8 rounded-full bg-foreground px-6 py-3 text-[15px] font-medium text-background">
          {t.inbox}
        </button>
      </div>
    );

  if (preview !== null)
    return (
      <div className="px-5 py-5">
        <button onClick={() => setPreview(null)} className="inline-flex items-center gap-1 text-[14px] text-muted-foreground">
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t.back}
        </button>
        <h2 className="mt-4 text-[24px] font-bold">{t.review}</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">{t.confirm}</p>
        <pre dir="ltr" className="mt-4 whitespace-pre-wrap rounded-2xl bg-secondary p-4 font-sans text-[14px] leading-relaxed">
          {preview}
        </pre>
        {err && <p className="mt-3 text-[13px] text-risk-high">{err}</p>}
        <button onClick={submit} disabled={busy} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-[16px] font-semibold text-background disabled:opacity-50">
          {busy && <Loader2 className="size-4 animate-spin" />} {t.sign}
        </button>
      </div>
    );

  const q = qs[step];
  return (
    <div className="flex min-h-[700px] flex-col px-5 py-5">
      <div className="flex items-center justify-between text-[13px]">
        <button onClick={step === 0 ? onClose : () => setStep((s) => s - 1)} className="inline-flex items-center gap-1 text-muted-foreground">
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t.back}
        </button>
        <span className="font-medium">{t.of(step + 1, n)}</span>
        <span className="w-14 text-end text-[11px] text-muted-foreground">{saving === "saving" ? t.saving : saving === "saved" ? t.saved : ""}</span>
      </div>
      <div className="mt-3 flex gap-1">
        {qs.map((x, i) => (
          <span key={x.gapId} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-foreground" : "bg-secondary")} />
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 text-[12px] text-muted-foreground">
        <span className="flex size-7 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-foreground">{initials(d.patient?.name)}</span>
        {d.patient?.name} · {d.payer?.name}
      </div>
      <div dir="ltr" className="mt-4 rounded-xl bg-secondary px-3 py-2 font-mono text-[12px]">
        {q.order}
      </div>
      <h2 className="mt-3 text-[24px] font-bold leading-snug tracking-tight">{lang === "ar" ? q.textAr : q.textEn}</h2>
      <p dir={lang === "ar" ? "ltr" : "rtl"} className="mt-1.5 text-[14px] text-muted-foreground">
        {lang === "ar" ? q.textEn : q.textAr}
      </p>
      <details className="mt-3 text-[13px]">
        <summary className="cursor-pointer text-muted-foreground">{t.why}</summary>
        <p dir="ltr" className="mt-1.5 leading-relaxed">
          {q.insurerNeeds}
        </p>
      </details>

      <div className="mt-5 space-y-4">
        {q.fields.map((f) => {
          const v = answers[q.gapId]?.[f.key] ?? "";
          const label = lang === "ar" ? f.labelAr : f.labelEn;
          return (
            <label key={f.key} className={cn("block rounded-2xl transition-shadow", glowKey === `${q.gapId}|${f.key}` && "field-glow -mx-2 px-2 py-1")}>
              <span className="flex items-center justify-between text-[13px] font-medium">
                {label}
                {glowKey === `${q.gapId}|${f.key}` && <span className="text-[11px] font-light text-[#237a4b]">filled in by SEAL · check it</span>}
              </span>
              {f.kind === "choice" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {f.options!.map((o) => (
                    <button type="button" key={o} onClick={() => setField(q.gapId, f.key, o)} className={cn("rounded-full px-3.5 py-1.5 text-[14px]", v === o ? "bg-foreground text-background" : "bg-secondary")}>
                      {o}
                    </button>
                  ))}
                </div>
              ) : f.kind === "text" ? (
                <textarea value={String(v)} onChange={(e) => setField(q.gapId, f.key, e.target.value)} rows={3} className="mt-2 w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-[15px] outline-none focus:border-foreground" />
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type={f.kind === "number" ? "number" : "date"}
                    inputMode={f.kind === "number" ? "decimal" : undefined}
                    value={String(v)}
                    onChange={(e) => setField(q.gapId, f.key, f.kind === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-[16px] outline-none focus:border-foreground"
                  />
                  {f.unit && <span className="text-muted-foreground">{f.unit}</span>}
                </div>
              )}
            </label>
          );
        })}
      </div>
      {err && <p className="mt-3 text-[13px] text-risk-high">{err}</p>}
      <div className="mt-auto pt-8">
        {step < n - 1 ? (
          <button onClick={() => setStep((s) => s + 1)} disabled={!complete(q)} className="w-full rounded-full bg-foreground py-3.5 text-[16px] font-semibold text-background disabled:opacity-30">
            {t.next}
          </button>
        ) : (
          <button onClick={review} disabled={!qs.every(complete) || busy} className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-[16px] font-semibold text-background disabled:opacity-30">
            {busy && <Loader2 className="size-4 animate-spin" />} {t.review}
          </button>
        )}
      </div>
    </div>
  );
}
