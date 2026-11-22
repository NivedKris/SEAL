import type { MetadataRoute } from "next";

/** SEAL as an installable app: always opens on the opening film (video, SEAL letters, then the story), full screen, no browser bar. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "SEAL",
    short_name: "SEAL",
    description: "Every claim, complete. SEAL catches insurance claim refusals before they happen.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "any",
    background_color: "#eef2f0",
    theme_color: "#eef2f0",
    categories: ["medical", "business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Today", url: "/today", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Patients", url: "/emr", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Claims", url: "/billing", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Questions", url: "/doctor", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
