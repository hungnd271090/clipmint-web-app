import type { VideoPlan } from "@/lib/api/client";
import { assertVoiceBlob } from "@/features/video-rendering/voice";

type WorkerResponse =
  | { type: "progress"; progress: number; stage: string }
  | { type: "done"; buffer: ArrayBuffer }
  | { type: "error"; message: string };

export async function renderVideo(
  source: File,
  voice: Blob,
  plan: VideoPlan,
  subtitleStyle: string,
  onProgress: (progress: number, stage: string) => void,
): Promise<Blob> {
  assertVoiceBlob(voice);
  const worker = new Worker(new URL("../../workers/video-render.worker.ts", import.meta.url), { type: "module" });
  const sourceBuffer = await source.arrayBuffer();
  const voiceBuffer = await voice.arrayBuffer();
  return new Promise<Blob>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") onProgress(message.progress, message.stage);
      if (message.type === "done") {
        worker.terminate();
        resolve(new Blob([message.buffer], { type: "video/mp4" }));
      }
      if (message.type === "error") {
        worker.terminate();
        reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || "Video worker gặp lỗi.")); };
    worker.postMessage({ sourceBuffer, sourceName: source.name, voiceBuffer, voiceType: voice.type, plan, subtitleStyle }, [sourceBuffer, voiceBuffer]);
  });
}
