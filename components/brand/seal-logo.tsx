import { cn } from "@/lib/utils";

type SealLogoProps = {
  /** Rendered height in px; width scales with the wordmark. */
  height?: number;
  /** "auto" follows currentColor; "light" forces white letters (for dark tiles). */
  tone?: "auto" | "light" | "dark";
  className?: string;
  title?: string;
};

/**
 * SEAL wordmark: "SEAL" in bold serif with a green full stop.
 * Pure SVG so it stays sharp at every size (top bar, phone header, favicon, loader).
 */
export function SealLogo({ height = 24, tone = "auto", className, title = "SEAL" }: SealLogoProps) {
  const fill = tone === "light" ? "#f5f5f7" : tone === "dark" ? "#000000" : "currentColor";
  return (
    <svg
      role="img"
      aria-label={title}
      viewBox="0 0 196 64"
      height={height}
      width={(height * 196) / 64}
      className={cn("shrink-0 select-none", className)}
    >
      <title>{title}</title>
      <text
        x="0"
        y="54"
        fill={fill}
        fontFamily="var(--font-source-serif), 'Source Serif 4', Georgia, serif"
        fontWeight={800}
        fontSize="68"
        letterSpacing="-1"
        textLength="175"
        lengthAdjust="spacingAndGlyphs"
      >
        SEAL
      </text>
      <circle cx="186" cy="48" r="8.5" fill="var(--seal-green, #3ecf7f)" />
    </svg>
  );
}

/** Square mark for tight spaces: a dark tile with "S." */
export function SealMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} role="img" aria-label="SEAL">
      <rect width="64" height="64" rx="14" fill="#111827" />
      <text x="13" y="48" fill="#f5f5f7" fontFamily="var(--font-source-serif), Georgia, serif" fontWeight={800} fontSize="44">
        S
      </text>
      <circle cx="49" cy="43" r="5.5" fill="#3ecf7f" />
    </svg>
  );
}
