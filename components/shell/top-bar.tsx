"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Banknote, BookCheck, ClipboardList, House, MessageCircleQuestion, Settings, Sparkles, Stethoscope } from "lucide-react";
import { SealLogo } from "@/components/brand/seal-logo";
import { APP_ROUTES, userFor } from "@/lib/routes";
import { warmAllWhenIdle, warmPage } from "@/lib/client/page-data";
import { cn } from "@/lib/utils";
import { TENANTS, type TenantId } from "@/lib/tenant";
import { ArrowLeftRight } from "lucide-react";

const TAB_ICON: Record<string, React.ComponentType<{ className?: string }>> = { "/today": House, "/emr": Stethoscope, "/doctor": MessageCircleQuestion, "/billing": ClipboardList, "/clinic": Banknote, "/rules": BookCheck, "/ai-health": Sparkles };
const initials = (n: string) => n.replace(/^Dr\.\s*/, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("");

/** Glass top bar: wordmark, the views, who is signed in, language, settings. */
export function TopBar({ tenant = "basic" }: { tenant?: TenantId }) {
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
  // Inside the app, warm every tab's data once the page is idle, so tab switches are instant.
  useEffect(() => {
    if (pathname !== "/" && pathname !== "/select") warmAllWhenIdle(pathname);
  }, [pathname]);
  const me = userFor(pathname);
  // The landing is a full-screen film: just the wordmark and one way in, floating over the scene.
  if (pathname === "/" || pathname === "/select")
    return (
      <header className="fixed inset-x-0 top-0 z-50 text-[#1f2b29]">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 md:px-8">
          <Link href="/" aria-label="SEAL home" dir="ltr">
            <SealLogo height={24} />
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/select" className={cn("rounded-full px-4 py-2 text-[13px] font-light tracking-[0.12em] ring-1 ring-[#1f2b29]/25 backdrop-blur-xl transition-colors hover:bg-[#1f2b29] hover:text-[#f1f4f2]", pathname === "/select" && "invisible")}>
              OPEN SEAL
            </Link>
          </div>
        </div>
      </header>
    );
  return (
    <>
    <header className="sticky top-0 z-50 border-b border-white/70 bg-[#eef2f0]/70 text-ink shadow-[0_1px_0_rgba(31,43,41,0.05)] backdrop-blur-2xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 md:gap-6 md:px-6 lg:gap-8">
        <Link href="/today" className="flex items-center gap-3 text-ink" aria-label={`${TENANTS[tenant].hospital}, today`} dir="ltr">
          {TENANTS[tenant].logo ? (
            <span className="flex items-center gap-2.5">
              {/* the hospital's own brand leads; SEAL is the engine underneath */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={TENANTS[tenant].logo!.src} alt={TENANTS[tenant].hospital} width={TENANTS[tenant].logo!.width} height={TENANTS[tenant].logo!.height} className="h-[40px] w-auto" />
              <span className="hidden border-l border-ink/15 pl-2.5 text-[10px] font-light leading-tight tracking-[0.18em] text-ink/50 lg:block">
                WITH
                <br />
                <span className="text-[12px] font-semibold tracking-normal text-ink/80">SEAL.</span>
              </span>
            </span>
          ) : (
            <SealLogo height={22} />
          )}
          <LivePebble />
        </Link>
        <Link href="/select" title="Switch hospital" aria-label="Switch hospital" className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-light text-ink/55 ring-1 ring-ink/10 transition-colors hover:bg-white/60 hover:text-ink">
          <ArrowLeftRight className="size-3.5" />
          <span className="hidden xl:inline">Switch</span>
        </Link>
        <div className="flex-1 md:hidden" />
        <nav className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto text-[14px] md:flex">
          {APP_ROUTES.map((r) => {
            const active = pathname === r.href || pathname.startsWith(r.href + "/");
            return (
              <Link key={r.href} href={r.href} onPointerEnter={() => warmPage(r.href)} onFocus={() => warmPage(r.href)} onTouchStart={() => warmPage(r.href)} className={cn("whitespace-nowrap rounded-full px-3.5 py-1.5 font-light tracking-[0.01em] transition-all", active ? "bg-white/80 text-ink shadow-[0_0_0_1px_rgba(31,43,41,0.08),0_6px_20px_-8px_rgba(31,43,41,0.25)]" : "text-ink/60 hover:bg-white/50 hover:text-ink")}>
                {lang === "ar" ? r.labelAr : r.label}
              </Link>
            );
          })}
        </nav>
        <button onClick={() => setLang((l) => (l === "en" ? "ar" : "en"))} className="rounded-full px-3 py-1.5 text-[13px] font-light text-ink/60 hover:bg-white/50 hover:text-ink" aria-label="Switch language">
          {lang === "en" ? "عربي" : "English"}
        </button>
        {me && (
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-white to-seal-mint text-[12px] font-medium text-ink ring-1 ring-ink/10">{initials(me.user)}</span>
            <div className="hidden leading-tight xl:block">
              <div className="text-[13px] font-medium">{me.user}</div>
              <div className="text-[11px] font-light text-ink/55">{lang === "ar" ? me.roleAr : me.role}</div>
            </div>
          </div>
        )}
        <Link href="/admin" aria-label="Settings" className={cn("rounded-full p-2 text-ink/55 hover:bg-white/60 hover:text-ink", pathname.startsWith("/admin") && "bg-white/80 text-ink")}>
          <Settings className="size-[18px]" />
        </Link>
      </div>
    </header>
      {/* Phones: Instagram-style tab bar at the bottom */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/80 bg-[#eef2f0]/85 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_rgba(31,43,41,0.05)] backdrop-blur-2xl md:hidden" aria-label="Views">
        <div className="grid grid-cols-7">
          {APP_ROUTES.map((r) => {
            const active = pathname === r.href || pathname.startsWith(r.href + "/");
            const Icon = TAB_ICON[r.href] ?? Sparkles;
            return (
              <Link key={r.href} href={r.href} onPointerEnter={() => warmPage(r.href)} onFocus={() => warmPage(r.href)} onTouchStart={() => warmPage(r.href)} className={cn("flex flex-col items-center gap-1 py-2.5 text-[9.5px] font-light transition-colors", active ? "text-ink" : "text-ink/50")}>
                <span className={cn("flex h-7 w-11 items-center justify-center rounded-full transition-colors", active && "bg-white/90 shadow-[0_0_0_1px_rgba(31,43,41,0.08)]")}>
                  <Icon className="size-[19px]" />
                </span>
                {lang === "ar" ? r.labelAr : r.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

/** The film's pebble, small: a warm light that beats while SEAL is live. */
function LivePebble() {
  return (
    <span className="relative hidden size-4 items-center justify-center sm:flex" title="SEAL is live">
      <span className="absolute inset-0 rounded-full bg-gradient-to-br from-white to-[#f4e6cf] ring-1 ring-ink/10" />
      <span className="heartbeat relative size-1.5 rounded-full bg-[#f0b45a] shadow-[0_0_8px_2px_rgba(240,180,90,0.6)]" />
    </span>
  );
}
