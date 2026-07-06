import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Proxy WAHA API — permite al frontend enviar mensajes sin exponer credenciales
      {
        source: "/api/waha/:path*",
        destination: "http://localhost:3000/:path*",
      },
    ];
  },
};

export default nextConfig;
