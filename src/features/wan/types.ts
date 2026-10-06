export const WAN_ENDPOINT = "fal-ai/wan/v2.2-a14b/image-to-video/turbo";
// Verified 2026-10-06 against the endpoint's official API schema.
// No duration or multi-reference image input is defined for this endpoint.
export const capabilities = {
  endpoint: WAN_ENDPOINT,
  resolutions: ["480p", "580p", "720p"],
  ratios: ["9:16", "16:9", "1:1", "auto"],
  durations: [] as number[],
  voices: ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"],
  imageModels: ["gpt-image-1", "gpt-image-1-mini", "gpt-image-1.5"],
};
export interface Settings {
  provider: "fal.ai"; falKey: string; openaiKey: string; endpoint: string;
  textModel: string; imageModel: string; ttsModel: string;
  resolution: string; timeoutSeconds: number; pollSeconds: number; concurrency: number;
  acceleration: string; videoQuality: string; videoWriteMode: string;
  promptExpansion: boolean; seed: number | null;
}
export type PublicSettings = Omit<Settings, "falKey" | "openaiKey"> & {
  falConfigured: boolean; openaiConfigured: boolean; falKeyMasked: string; openaiKeyMasked: string;
};
export interface Asset {
  id: string; name: string; file: string; hash: string;
  mime: string; size: number; duration?: number;
  kind: "image" | "audio" | "music" | "video";
  narration?: string;
  origin?: "upload" | "generated";
}
export interface Scene {
  id: string; name: string; prompt: string; motion: string;
  original: boolean; sourceId: string; imageId?: string; videoId?: string;
  imageKey?: string; videoKey?: string;
}
export interface Suggestion { name: string; description: string; motion: string }
export interface AudioOptions {
  enabled: boolean; source: "upload" | "url" | "tts"; url: string;
  audioId: string; musicId: string; text: string; language: string; voice: string; speed: number;
  start: number; end: number | null; volume: number; musicVolume: number;
  subtitles: boolean; overflow: "trim" | "extend";
}
export interface Project {
  id: string; revision: number; createdAt: string; updatedAt: string;
  name: string; features: string; message: string; primaryId: string;
  mode: "suggest" | "manual"; suggestions: Suggestion[]; scenes: Scene[];
  assets: Asset[]; audio: AudioOptions; ratio: string; resolution: string;
  finalId?: string; finalKey?: string;
}
export type Action = "suggest" | "improve" | "copy" | "image" | "video" | "tts" | "extract" | "compose";
export type JobStatus = "queued" | "running" | "polling" | "succeeded" | "failed" | "uncertain";
export interface Job {
  id: string; projectId: string; sceneId?: string; action: Action;
  key: string; status: JobStatus; stage: string; error?: string;
  createdAt: string; updatedAt: string; snapshot: Project; model: string;
  params: Record<string, unknown>; requestId?: string; statusURL?: string; responseURL?: string;
  submittedAt?: string; phase?: "submitting" | "submitted";
  result?: { file?: string; data?: unknown }; cached?: boolean;
  force?: boolean;
  providerFailed?: boolean;
}
export interface ProjectResponse { project: Project; jobs: Job[] }
