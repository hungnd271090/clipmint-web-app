import type { ExtractedFrame } from "@/types";

const FRAME_COUNT = 24;
const MAX_FRAME_WIDTH = 720;

export async function extractRepresentativeFrames(file: File, duration: number): Promise<ExtractedFrame[]> {
  const videoURL = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = videoURL;
  try {
    await event(video, "loadeddata");
    const count = Math.min(FRAME_COUNT, Math.max(6, Math.ceil(duration / 5)));
    const timestamps = Array.from({ length: count }, (_, index) => Math.min(duration - 0.05, ((index + 0.5) / count) * duration));
    const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Trình duyệt không hỗ trợ Canvas 2D.");

    const frames: ExtractedFrame[] = [];
    for (const timestamp of timestamps) {
      await seek(video, timestamp);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await canvasBlob(canvas, "image/webp", 0.72);
      frames.push({ timestampSeconds: Number(timestamp.toFixed(2)), mimeType: "image/webp", dataBase64: await blobToBase64(blob) });
    }
    return frames;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(videoURL);
  }
}

function event(target: HTMLVideoElement, name: "loadeddata"): Promise<void> {
  return new Promise((resolve, reject) => {
    target.addEventListener(name, () => resolve(), { once: true });
    target.addEventListener("error", () => reject(new Error("Không thể đọc video để trích xuất frame.")), { once: true });
  });
}

function seek(video: HTMLVideoElement, timestamp: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => resolve();
    const failed = () => reject(new Error(`Không thể đọc frame tại ${timestamp.toFixed(1)}s.`));
    video.addEventListener("seeked", done, { once: true });
    video.addEventListener("error", failed, { once: true });
    video.currentTime = timestamp;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Không thể nén frame.")), type, quality));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

