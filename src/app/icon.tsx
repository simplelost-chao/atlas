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
          background: "white",
          borderRadius: 6,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 64 64" fill="none">
          <polygon points="32,4 40,18 24,18" fill="#111827" />
          <polygon points="22,21 30,21 26,28" fill="#C59D5F" />
          <polygon points="34,21 42,21 38,28" fill="#111827" />
          <polygon points="14,44 24,31 28,31 20,44" fill="#111827" />
          <polygon points="36,31 40,31 50,44 44,44" fill="#111827" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
