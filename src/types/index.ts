export type VideoMeta = {
  duration: number;
  width: number;
  height: number;
  size: number;
  name: string;
  warnings: string[];
};

export type ExtractedFrame = {
  timestampSeconds: number;
  mimeType: "image/jpeg" | "image/webp";
  dataBase64: string;
};

export type ProductFormData = {
  productName: string;
  brand: string;
  productUrl: string;
  featuresText: string;
};

export type ProductAsset = {
  id: string;
  name: string;
  source: "url" | "upload";
  previewUrl: string;
  remoteUrl?: string;
  file?: File;
};

export type VideoConfiguration = {
  count: 1 | 2 | 3;
  duration: 15 | 20 | 30;
  voice: "coral" | "marin" | "cedar" | "nova";
  voiceStyle: string;
  subtitleStyle: "mint" | "bold" | "minimal";
};

export type RenderResult = {
  id: string;
  hookText: string;
  duration: number;
  resolution: string;
  filename: string;
  url: string;
  blob: Blob;
};

export type DirectoryHandleLike = {
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
};
