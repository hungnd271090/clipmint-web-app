import type { DirectoryHandleLike } from "@/types";

declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<DirectoryHandleLike>;
  }
}

export async function chooseOutputDirectory(): Promise<DirectoryHandleLike | null> {
  if (!window.showDirectoryPicker) return null;
  return window.showDirectoryPicker();
}

export async function saveBlob(blob: Blob, filename: string, directory: DirectoryHandleLike | null): Promise<"directory" | "download"> {
  if (directory) {
    const handle = await directory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "directory";
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return "download";
}

