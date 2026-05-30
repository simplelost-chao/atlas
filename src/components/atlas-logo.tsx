"use client";

interface AtlasLogoProps {
  size?: number;
  animated?: boolean;
  className?: string;
  color?: string;
}

export function AtlasLogo({ size = 32, animated = false, className = "", color = "#374151" }: AtlasLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${animated ? "animate-logo" : ""} ${className}`}
    >
      {/* Rounded square base */}
      <rect x="4" y="4" width="40" height="40" rx="10" fill={color} opacity="0.08" />
      {/* Mountain/A peak - two lines meeting at top */}
      <path d="M24 10L36 34H30L27.5 29H20.5L18 34H12L24 10Z" fill={color} />
      {/* Horizontal crossbar cutout - creates the A shape */}
      <path d="M21.5 26H26.5L24 20.5L21.5 26Z" fill="white" />
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
