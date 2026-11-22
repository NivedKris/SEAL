"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const DISMISSED = "seal-install-dismissed";

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * Registers SEAL's service worker (production builds only) and offers "Install SEAL":
 * the browser's own install prompt where there is one, a short how-to on iPhone and iPad.
 * Hidden on the landing film, once installed, and after the visitor closes it.
 */
export function Install() {
  const path = usePathname();
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED) === "1";
    } catch {}
    if (standalone() || dismissed) return;
    setHidden(false);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as PromptEvent);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const ua = navigator.userAgent;
    setIos(/iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1));
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {}
  };

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    if (outcome === "accepted") setHidden(true);
  };

  const show = !hidden && path !== "/" && path !== "/offline" && (prompt || ios);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="fixed left-4 z-40 bottom-[calc(148px+env(safe-area-inset-bottom))] md:bottom-6 max-w-[calc(100vw-6.5rem)] md:max-w-md"
        >
          <div className="card flex items-center gap-3 pl-3 pr-2 py-2 shadow-lg">
            <img src="/icons/icon-192.png" alt="" className="h-9 w-9 rounded-xl" />
            {prompt ? (
              <>
                <div className="text-sm leading-tight min-w-0">
                  <div className="text-ink font-medium">Install SEAL</div>
                  <div className="text-ink/60 text-xs">Opens like an app, full screen</div>
                </div>
                <button onClick={install} className="ml-1 rounded-full bg-ink text-white text-xs tracking-wide px-4 py-2 hover:opacity-90 transition">
                  Install
                </button>
              </>
            ) : (
              <div className="text-sm leading-tight text-ink min-w-0">
                <div className="font-medium">Add SEAL to your Home Screen</div>
                <div className="text-ink/60 text-xs">Tap Share, then “Add to Home Screen”</div>
              </div>
            )}
            <button onClick={close} aria-label="Close" className="ml-1 h-7 w-7 rounded-full text-ink/50 hover:text-ink hover:bg-ink/5 transition">
              ×
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
