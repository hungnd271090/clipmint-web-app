import { api, type MotionVideoPlan } from "@/lib/api/client";
import { assertAudibleVoiceBlob } from "@/features/video-rendering/voice";
import type { ProductAsset } from "@/types";

type WorkerResponse =
  | { type: "progress"; progress: number; stage: string }
  | { type: "done"; buffer: ArrayBuffer }
  | { type: "error"; message: string };

export async function renderMotionVideo(
  assets: ProductAsset[],
  voice: Blob,
  plan: MotionVideoPlan,
  subtitleStyle: string,
  onProgress: (progress: number, stage: string) => void,
): Promise<Blob> {
  await assertAudibleVoiceBlob(voice);
  const blobs = await Promise.all(assets.map(async (asset) => {
    if (asset.file) return asset.file;
    if (!asset.remoteUrl) throw new Error(`Ảnh ${asset.name} không còn nguồn dữ liệu.`);
    try {
      return await api.fetchProductImage(asset.remoteUrl);
    } catch {
      throw new Error(`Không tải được ${asset.name} từ link sản phẩm. Hãy thay ảnh này bằng ảnh trên thiết bị.`);
    }
  }));
  const assetBuffers = await Promise.all(blobs.map((blob) => blob.arrayBuffer()));
  const assetTypes = blobs.map((blob) => blob.type);
  const voiceBuffer = await voice.arrayBuffer();
  const worker = new Worker(new URL("../../workers/motion-render.worker.ts", import.meta.url), { type: "module" });

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
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || "Motion video worker gặp lỗi.")); };
    worker.postMessage({ assetBuffers, assetTypes, voiceBuffer, voiceType: voice.type, plan, subtitleStyle }, [...assetBuffers, voiceBuffer]);
  });
}
