"use client";

interface AtlasLogoProps {
  size?: number;
  animated?: boolean;
  className?: string;
}

export function AtlasLogo({ size = 32, animated = false, className = "" }: AtlasLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${animated ? "animate-logo" : ""} ${className}`}
    >
      {/* Outer triangle (mountain shape) */}
      <path
        d="M32 4L58 56H6L32 4Z"
        fill="#C59D5F"
        opacity={0.2}
      />
      {/* Inner A shape */}
      <path
        d="M32 8L54 52H42L38 44H26L22 52H10L32 8ZM29 36H35L32 28L29 36Z"
        fill="#C59D5F"
      />
    </svg>
  );
}

export function AtlasWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`text-xl font-bold tracking-wider text-white ${className}`}>
      ATLAS
    </span>
  );
}
