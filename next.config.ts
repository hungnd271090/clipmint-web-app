import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Local settings/input/output must never be bundled by file tracing.
  outputFileTracingExcludes: { "/*": ["./.clipmint-data/**/*"] },
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
      ],
    },
  ],
};

export default nextConfig;
