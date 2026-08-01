import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http://localhost:3000; media-src 'self' blob: http://localhost:3000; connect-src 'self' http://localhost:3000;",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      // NOTA: se eliminó el bloque CORS que enviaba
      // Access-Control-Allow-Origin: * con Allow-Credentials: true.
      // La app es same-origin (el CRM y la API viven en el mismo dominio) y
      // n8n llama server-to-server (CORS no aplica), así que no hace falta
      // abrir la API a cualquier origen.
    ];
  },
};

export default nextConfig;
