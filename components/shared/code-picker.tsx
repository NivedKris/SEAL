"use client";

import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/** Search box for orders (CPT subset) or diagnoses (ICD-10-CM); optional patterns narrow to qualifying codes. */
export function CodePicker({ type, onPick, placeholder, patterns, block, dark }: { type: "cpt" | "icd"; onPick: (code: string) => void; placeholder: string; patterns?: string[]; block?: boolean; dark?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ code: string; label?: string; description?: string }[]>([]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const u = `/api/emr/codes?type=${type}&q=${encodeURIComponent(q)}${patterns ? `&patterns=${encodeURIComponent(patterns.join(","))}` : ""}`;
      fetch(u).then((r) => r.json()).then((r) => setItems(r.codes ?? []));
    }, 150);
    return () => clearTimeout(t);
  }, [q, open, type, patterns]);
  return (
    <div className={cn("relative", block ? "w-full" : "w-[320px]")}>
      <div className={cn("flex items-center gap-2 rounded-full px-3.5 py-2 transition-colors", dark ? "bg-white/10 text-white focus-within:bg-white/15" : "bg-black/[0.04] focus-within:bg-black/[0.06]")}>
        {block ? <Search className="size-4 opacity-60" /> : <Plus className="size-4 opacity-60" />}
        <input value={q} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className={cn("w-full bg-transparent text-[14px] outline-none", dark ? "placeholder:text-white/50" : "placeholder:text-muted-foreground")} />
      </div>
      {open && items.length > 0 && (
        <div className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-2xl border border-black/[0.06] bg-white p-1.5 text-foreground shadow-xl">
          {items.map((it) => (
            <button
              key={it.code}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(it.code);
                setQ("");
                setOpen(false);
              }}
              className="flex w-full items-baseline gap-3 rounded-xl px-3 py-2 text-left text-[14px] hover:bg-black/[0.04]"
            >
              <span className="w-16 shrink-0 font-mono text-[12px] text-muted-foreground">{it.code}</span>
              <span>{it.label ?? it.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
