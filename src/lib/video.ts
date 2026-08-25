import type { VideoMeta } from "@/types";

export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 180;

export function validateVideoFile(file: Pick<File, "name" | "size" | "type">): string[] {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const typeAllowed = file.type === "video/mp4" || file.type === "video/quicktime";
  if (!typeAllowed && extension !== "mp4" && extension !== "mov") return ["Chỉ hỗ trợ video MP4 hoặc MOV."];
  if (file.size > MAX_VIDEO_BYTES) return ["Video không được vượt quá 300 MB."];
  if (file.size === 0) return ["Tệp video đang trống."];
  return [];
}

export function metadataWarnings(duration: number, width: number, height: number): string[] {
  const warnings: string[] = [];
  if (duration > MAX_VIDEO_SECONDS) warnings.push("Video không được dài quá 3 phút.");
  if (width >= 3840 || height >= 2160) warnings.push("Video 4K sẽ dựng chậm; nên dùng 1080p.");
  if (height <= width) warnings.push("Nên dùng video dọc tỷ lệ 9:16 để có kết quả tốt nhất.");
  return warnings;
}

export async function readVideoMeta(file: File): Promise<VideoMeta> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Không thể đọc thông tin video."));
    });
    const warnings = metadataWarnings(video.duration, video.videoWidth, video.videoHeight);
    if (video.duration > MAX_VIDEO_SECONDS) throw new Error(warnings[0]);
    return { duration: video.duration, width: video.videoWidth, height: video.videoHeight, size: file.size, name: file.name, warnings };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

