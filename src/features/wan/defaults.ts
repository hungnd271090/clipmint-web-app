import type { Settings } from "./types";
import { WAN_ENDPOINT } from "./types";
export const defaults: Settings = {
  provider: "fal.ai", falKey: "", openaiKey: "", endpoint: WAN_ENDPOINT,
  textModel: "gpt-4.1-mini", imageModel: "gpt-image-1", ttsModel: "gpt-4o-mini-tts",
  resolution: "720p", timeoutSeconds: 1800, pollSeconds: 5, concurrency: 1,
  acceleration: "regular", videoQuality: "high", videoWriteMode: "balanced", promptExpansion: false, seed: null,
};
