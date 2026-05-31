"use client";

interface AtlasLogoProps {
  size?: number;
  animated?: boolean;
  className?: string;
  darkColor?: string;
  goldColor?: string;
}

/**
 * Atlas Logo — geometric "A" composed of 5 separate blocks with white gaps:
 * - Top: dark triangle (peak)
 * - Middle-left: GOLD small triangle
 * - Middle-right: dark triangle
 * - Bottom-left: dark trapezoid
 * - Bottom-right: dark trapezoid
 */
export function AtlasLogo({
  size = 32,
  animated = false,
  className = "",
  darkColor = "#111827",
  goldColor = "#C59D5F",
  variant = "light",
}: AtlasLogoProps & { variant?: "light" | "dark" }) {
  // On dark backgrounds: all blocks white, gold stays gold
  // On light backgrounds: blocks dark, gold stays gold
  const mainColor = variant === "dark" ? "white" : darkColor;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${animated ? "animate-logo" : ""} ${className}`}
    >
      {/* Top triangle — peak of the A */}
      <polygon points="32,4 40,18 24,18" fill={mainColor} />

      {/* Middle-left triangle — GOLD accent */}
      <polygon points="22,21 30,21 26,28" fill={goldColor} />

      {/* Middle-right triangle */}
      <polygon points="34,21 42,21 38,28" fill={mainColor} />

      {/* Bottom-left trapezoid */}
      <polygon points="14,44 24,31 28,31 20,44" fill={mainColor} />

      {/* Bottom-right trapezoid */}
      <polygon points="36,31 40,31 50,44 44,44" fill={mainColor} />
    </svg>
  );
}

export function AtlasWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`text-lg font-bold tracking-[0.2em] ${className}`}>
      ATLAS
    </span>
  );
}
