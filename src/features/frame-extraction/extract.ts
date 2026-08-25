import type { ExtractedFrame } from "@/types";

export const MAX_FRAME_COUNT = 8;
export const MAX_FRAME_BINARY_BYTES = 180_000;
export const MAX_TOTAL_FRAME_BINARY_BYTES = 1_500_000;

const MAX_FRAME_WIDTH = 480;
const FRAME_WIDTH_STEPS = [MAX_FRAME_WIDTH, 400, 320] as const;
const QUALITY_STEPS = [0.62, 0.5, 0.4] as const;

export async function extractRepresentativeFrames(file: File, duration: number): Promise<ExtractedFrame[]> {
  const videoURL = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = videoURL;
  try {
    await event(video, "loadeddata");
    const timestamps = representativeTimestamps(duration);
    const canvas = document.createElement("canvas");
    const frames: ExtractedFrame[] = [];
    let totalBytes = 0;
    for (const timestamp of timestamps) {
      await seek(video, timestamp);
      const blob = await compressFrame(video, canvas);
      if (totalBytes + blob.size > MAX_TOTAL_FRAME_BINARY_BYTES) {
        throw new Error("Các frame vẫn quá lớn sau khi nén. Hãy dùng video có độ phân giải thấp hơn.");
      }
      totalBytes += blob.size;
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

export function representativeTimestamps(duration: number): number[] {
  const count = Math.min(MAX_FRAME_COUNT, Math.max(4, Math.ceil(duration / 5)));
  return Array.from(
    { length: count },
    (_, index) => Math.max(0, Math.min(duration - 0.05, ((index + 0.5) / count) * duration)),
  );
}

async function compressFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<Blob> {
  let smallest: Blob | null = null;
  for (const targetWidth of FRAME_WIDTH_STEPS) {
    const scale = Math.min(1, targetWidth / video.videoWidth);
    canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Trình duyệt không hỗ trợ Canvas 2D.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    for (const quality of QUALITY_STEPS) {
      const blob = await canvasBlob(canvas, "image/webp", quality);
      if (blob.type !== "image/webp") throw new Error("Trình duyệt không hỗ trợ nén WebP.");
      if (!smallest || blob.size < smallest.size) smallest = blob;
      if (blob.size <= MAX_FRAME_BINARY_BYTES) return blob;
    }
  }
  throw new Error(`Không thể nén frame xuống dưới ${Math.round(MAX_FRAME_BINARY_BYTES / 1000)} KB (nhỏ nhất ${Math.round((smallest?.size ?? 0) / 1000)} KB).`);
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
