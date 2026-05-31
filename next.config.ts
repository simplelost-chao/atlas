import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["atlas.zhuchao.life"],
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
    ];
  },
};

export default nextConfig;
