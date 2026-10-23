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
    // Solo se sirve por HTTPS (túnel de Cloudflare): el navegador no vuelve a
    // intentar HTTP en un año, ni en subdominios.
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
  {
    // 'unsafe-inline' en script-src se queda: Next inyecta scripts inline para
    // hidratar y quitarlo exige CSP con nonce (render dinámico en todo el sitio).
    // base-uri/form-action/object-src cierran inyección de <base>, formularios
    // que exfiltran a otro dominio y plugins.
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://static.whatsapp.net; media-src 'self' blob:; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none';",
  },
];

const nextConfig: NextConfig = {
  // Genera un build standalone (~150 MB) que incluye su propio servidor.
  // Necesario para el Dockerfile multi-stage de producción.
  output: 'standalone',
  poweredByHeader: false,
  // La app no usa next/image: se apaga el optimizador (/_next/image), que es
  // superficie de ataque (CVE de SSRF/DoS) sin nada que ganar.
  images: { unoptimized: true },

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
