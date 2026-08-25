import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "@ffmpeg", "core", "dist", "umd");
const target = join(root, "public", "ffmpeg");
await mkdir(target, { recursive: true });
for (const name of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  await cp(join(source, name), join(target, name));
}

