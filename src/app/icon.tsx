import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111827",
          borderRadius: 6,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 64 64" fill="none">
          <path d="M32 8L54 52H42L38 44H26L22 52H10L32 8ZM29 36H35L32 28L29 36Z" fill="#C59D5F" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
