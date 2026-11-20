"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { SealLogo } from "@/components/brand/seal-logo";
import { APP_ROUTES, userFor } from "@/lib/routes";
import { cn } from "@/lib/utils";

const initials = (n: string) => n.replace(/^Dr\.\s*/, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("");

/** Glass top bar: wordmark, the views, who is signed in, language, settings. */
export function TopBar() {
  const pathname = usePathname();
  const [lang, setLang] = useState<"en" | "ar">("en");
  useEffect(() => {
    try {
      if (localStorage.getItem("seal-lang") === "ar") setLang("ar");
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem("seal-lang", lang);
    } catch {}
  }, [lang]);
  const me = userFor(pathname);
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#07090c]/90 text-white backdrop-blur-2xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-8 px-6">
        <Link href="/" className="text-white" aria-label="SEAL home" dir="ltr">
          <SealLogo height={22} />
        </Link>
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-[14px]">
          {APP_ROUTES.map((r) => {
            const active = pathname === r.href || pathname.startsWith(r.href + "/");
            return (
              <Link key={r.href} href={r.href} className={cn("whitespace-nowrap rounded-full px-3.5 py-1.5 font-medium transition-all", active ? "bg-seal-green text-[#06120b] shadow-[0_0_24px_-4px_rgba(62,207,127,0.6)]" : "text-white/60 hover:bg-white/[0.06] hover:text-white")}>
                {lang === "ar" ? r.labelAr : r.label}
              </Link>
            );
          })}
        </nav>
        <button onClick={() => setLang((l) => (l === "en" ? "ar" : "en"))} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-white/60 hover:bg-white/[0.06] hover:text-white" aria-label="Switch language">
          {lang === "en" ? "عربي" : "English"}
        </button>
        {me && (
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-seal-green text-[12px] font-semibold text-[#06120b]">{initials(me.user)}</span>
            <div className="hidden leading-tight xl:block">
              <div className="text-[13px] font-semibold">{me.user}</div>
              <div className="text-[11px] text-white/50">{lang === "ar" ? me.roleAr : me.role}</div>
            </div>
          </div>
        )}
        <Link href="/admin" aria-label="Settings" className={cn("rounded-full p-2 text-white/60 hover:bg-white/[0.06] hover:text-white", pathname.startsWith("/admin") && "bg-white/10 text-white")}>
          <Settings className="size-[18px]" />
        </Link>
      </div>
    </header>
  );
}
