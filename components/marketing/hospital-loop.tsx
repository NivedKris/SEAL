"use client";

import { Building2, Cross, HeartPulse, Hospital, Activity, Stethoscope, ShieldPlus, Waves } from "lucide-react";
import LogoLoop, { type LogoItem } from "@/components/LogoLoop";

/**
 * Hospital wordmarks for the landing-page logo scroll.
 * All names are fictional (plan §3: hospitals, insurers and people are fictional;
 * nothing may claim a real partnership).
 */
const HOSPITALS: { name: string; Icon: React.ComponentType<{ className?: string }>; style: string }[] = [
  { name: "Seabreeze Specialty Hospital", Icon: Waves, style: "font-serif font-bold" },
  { name: "Halcyon Bay Medical City", Icon: Building2, style: "font-semibold tracking-tight" },
  { name: "NORTHWIND ROYAL", Icon: Cross, style: "font-bold tracking-[0.18em] text-[15px]" },
  { name: "Juniper Crest Health", Icon: HeartPulse, style: "font-serif italic font-semibold" },
  { name: "Meridian Dunes Hospital", Icon: Hospital, style: "font-medium" },
  { name: "Saltmarsh General", Icon: Activity, style: "font-black tracking-tight" },
  { name: "Lantern Oasis Medical", Icon: Stethoscope, style: "font-serif font-semibold" },
  { name: "CORNICHE PEARL", Icon: ShieldPlus, style: "font-semibold tracking-[0.14em] text-[15px]" },
];

const logosFor = (dark: boolean): LogoItem[] => HOSPITALS.map(({ name, Icon, style }) => ({
  title: name,
  ariaLabel: name,
  node: (
    <span className={`flex items-center gap-2.5 whitespace-nowrap text-[19px] transition-colors ${dark ? "text-white/55 hover:text-white" : "text-foreground/70 hover:text-foreground"}`}>
      <Icon className="size-6" />
      <span className={style}>{name}</span>
    </span>
  ),
}));

export function HospitalLoop({ dark = false }: { dark?: boolean }) {
  return (
    <LogoLoop
      logos={logosFor(dark)}
      speed={60}
      direction="left"
      logoHeight={32}
      gap={72}
      pauseOnHover
      scaleOnHover
      fadeOut
      fadeOutColor={dark ? "#05070a" : "#ffffff"}
      ariaLabel="Hospitals"
    />
  );
}
