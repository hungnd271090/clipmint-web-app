import { mkdir } from "node:fs/promises";
import path from "node:path";
import { atomicJSON, exists, files, localPath, locked, readJSON, persistFile, fileSize, removeStored } from "./storage";
export interface CacheEntry { key: string; file?: string; data?: unknown }
export async function getCache(key: string) {
  try {
    const entry = await readJSON<CacheEntry>(localPath("cache/" + key + "/result.json"));
    if (entry.file && !await exists(localPath(entry.file))) return null;
    return entry;
  } catch (e) { if (["ENOENT"].includes((e as NodeJS.ErrnoException).code || "")) return null; throw e; }
}
export async function saveCache(entry: CacheEntry) {
  if(entry.file)await persistFile(localPath(entry.file));
  if (entry.file && !await exists(localPath(entry.file))) throw new Error("Missing cache output");
  await atomicJSON(localPath("cache/" + entry.key + "/result.json"),entry);
}
export async function cacheOutput(key: string,extension: string) {
  const relative = "cache/" + key + "/output" + extension;
  await mkdir(path.dirname(localPath(relative)),{recursive:true}); return relative;
}
export async function cacheStats() {
  let bytes=0; let entries=0;
  for (const dir of await files("cache")) {
    entries++;
    for (const file of await files("cache/" + dir)) bytes += await fileSize(localPath("cache/" + dir + "/" + file)).catch(()=>0);
  }
  return {bytes,entries};
}
export async function clearCache() {
  return locked("queue",async()=>{
    // The worker and enqueue share this lock. Never clear an in-flight output.
    for (const file of await files("jobs")) {
      const j = await readJSON<{status:string}>(localPath("jobs/" + file));
      if (["queued","running","polling"].includes(j.status)) throw new Error("Có job đang chạy/chờ. Chờ job kết thúc trước khi xóa cache.");
    }
    await removeStored(localPath("cache"),true);
    return cacheStats();
  });
}
