import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Preserve the existing unmerged Meta AI UI byte-for-byte; these legacy
  // lint patterns predate the Wan work and are scoped to this component.
  { files: ["src/components/meta-ai/MetaAIProductFlow.tsx"],
    rules: { "react-hooks/set-state-in-effect": "off", "@next/next/no-html-link-for-pages": "off" } },
  globalIgnores([".next/**", ".clipmint-data/**", "public/ffmpeg/**", "src/lib/api/schema.d.ts"]),
]);
