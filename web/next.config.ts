import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const entra = "https://login.microsoftonline.com";

// The static CSP from the Next.js CSP guide ("Without Nonces"): nonces need every page rendered
// per request, which rules out the prerendered shells of Cache Components. MSAL renews tokens in
// a hidden iframe that goes to Entra and back to the /redirect bridge, so both may be framed.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self' ${entra} https://*.services.ai.azure.com wss://*.services.ai.azure.com`,
  `frame-src 'self' ${entra}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  // The Docker image runs the minimal server that `next build` writes to .next/standalone.
  output: "standalone",
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        // MSAL's redirect bridge page must not be cached; see the msal-browser redirect-bridge docs.
        source: "/redirect",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
