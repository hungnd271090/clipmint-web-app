import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Local settings/input/output must never be bundled by file tracing.
  outputFileTracingExcludes: {
    "/*": ["./.clipmint-data/**/*"],
    // Vercel Node uses Linux glibc; unused musl/WASM Sharp builds needlessly
    // consume the function bundle budget next to the native media binaries.
    "/api/wan/*": ["node_modules/@img/*linuxmusl*/**/*", "node_modules/@img/sharp-wasm32/**/*"],
  },
  outputFileTracingIncludes: { "/api/wan/*": ["node_modules/@ffmpeg-binary/linux-x64/ffmpeg", "node_modules/@ffprobe-installer/linux-x64/ffprobe", "src/server/wan/fonts/*"] },
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
