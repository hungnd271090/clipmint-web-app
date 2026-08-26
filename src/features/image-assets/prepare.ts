import {
  blobToBase64,
  compressImageSource,
  MAX_FRAME_COUNT,
  MAX_TOTAL_FRAME_BINARY_BYTES,
} from "@/features/frame-extraction/extract";
import type { ExtractedFrame, ProductAsset } from "@/types";

type FetchRemoteImage = (remoteURL: string) => Promise<Blob>;

export async function prepareProductAssetFrames(
  assets: ProductAsset[],
  fetchRemoteImage: FetchRemoteImage,
): Promise<ExtractedFrame[]> {
  const frames: ExtractedFrame[] = [];
  let totalBytes = 0;

  for (const [assetIndex, asset] of assets.slice(0, MAX_FRAME_COUNT).entries()) {
    const source = asset.file ?? (asset.remoteUrl ? await fetchRemoteImage(asset.remoteUrl) : null);
    if (!source) throw new Error(`Không thể đọc ${asset.name}. Hãy thay ảnh và thử lại.`);

    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
    } catch {
      try {
        bitmap = await createImageBitmap(source);
      } catch {
        throw new Error(`Ảnh ${asset.name} không hợp lệ hoặc trình duyệt không thể giải mã.`);
      }
    }

    try {
      const compressed = await compressImageSource(bitmap, bitmap.width, bitmap.height);
      if (totalBytes + compressed.size > MAX_TOTAL_FRAME_BINARY_BYTES) {
        throw new Error("Tổng dữ liệu ảnh quá lớn sau khi nén. Hãy dùng ít ảnh hơn.");
      }
      totalBytes += compressed.size;
      frames.push({
        timestampSeconds: assetIndex,
        mimeType: "image/webp",
        dataBase64: await blobToBase64(compressed),
      });
    } finally {
      bitmap.close();
    }
  }

  return frames;
}
