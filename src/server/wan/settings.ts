import type { PublicSettings, Settings } from "../../features/wan/types";
import { capabilities, WAN_ENDPOINT } from "../../features/wan/types";
import { atomicJSON, localPath, locked, readJSON, WanError } from "./storage";
export const defaults: Settings = {
  provider: "fal.ai", falKey: "", openaiKey: "", endpoint: WAN_ENDPOINT,
  textModel: "gpt-4.1-mini", imageModel: "gpt-image-1", ttsModel: "gpt-4o-mini-tts",
  resolution: "720p", timeoutSeconds: 1800, pollSeconds: 5, concurrency: 1,
  acceleration: "regular", videoQuality: "high", videoWriteMode: "balanced", promptExpansion: false, seed: null,
};
export async function getSettings(): Promise<Settings> {
  let saved: Partial<Settings> = {};
  try { saved = await readJSON<Settings>(localPath("settings.json")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  return { ...defaults, ...saved,
    falKey: saved.falKey ?? process.env.FAL_KEY ?? "",
    openaiKey: saved.openaiKey ?? process.env.OPENAI_API_KEY ?? "",
    textModel: saved.textModel ?? process.env.OPENAI_TEXT_MODEL ?? defaults.textModel,
    ttsModel: saved.ttsModel ?? process.env.OPENAI_TTS_MODEL ?? defaults.ttsModel,
  };
}
export function publicSettings(s: Settings): PublicSettings {
  const { falKey, openaiKey, ...safe } = s;
  return { ...safe, falConfigured: !!falKey, openaiConfigured: !!openaiKey,
    falKeyMasked: falKey ? "••••••••" : "", openaiKeyMasked: openaiKey ? "••••••••" : "" };
}
export function validateSettings(s: Settings) {
  if (s.provider !== "fal.ai" || s.endpoint !== WAN_ENDPOINT)
    throw new WanError("Chỉ endpoint Wan Turbo đã xác minh có adapter. Endpoint khác cần bổ sung schema/adapter trước khi sử dụng.");
  if (!capabilities.resolutions.includes(s.resolution) || !capabilities.imageModels.includes(s.imageModel) ||
      s.ttsModel !== "gpt-4o-mini-tts" || !s.textModel?.trim()) throw new WanError("Model hoặc resolution không được hỗ trợ.");
  for (const [value, min, max] of [[s.timeoutSeconds, 30, 7200], [s.pollSeconds, 2, 60], [s.concurrency, 1, 4]]) {
    if (!Number.isInteger(value) || value < min || value > max) throw new WanError("Timeout 30–7200s, polling 2–60s, số job 1–4.");
  }
  if (!["none","regular"].includes(s.acceleration) || !["low","medium","high","maximum"].includes(s.videoQuality) ||
      !["fast","balanced","small"].includes(s.videoWriteMode) || typeof s.promptExpansion !== "boolean" ||
      (s.seed !== null && (!Number.isInteger(s.seed) || s.seed < 0 || s.seed > 2147483647))) throw new WanError("Tham số nâng cao không hợp lệ.");
}
export async function putSettings(input: Partial<Settings>) {
  return locked("settings", async () => {
    const old = await getSettings(); const next = { ...old };
    // Explicit allowlist; an empty key field means preserve, never echo the key.
    for (const key of Object.keys(defaults) as (keyof Settings)[]) {
      if (input[key] !== undefined && key !== "falKey" && key !== "openaiKey")
        Object.assign(next, { [key]: input[key] });
    }
    for (const key of ["falKey","openaiKey"] as const) {
      if (typeof input[key] === "string" && input[key].trim()) next[key] = input[key].trim();
    }
    validateSettings(next); await atomicJSON(localPath("settings.json"), next);
    return publicSettings(next);
  });
}
