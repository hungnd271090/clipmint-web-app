import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm, stat, readdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { cloudMode, requestWorkspace } from "./runtime";
import { blobDownload, blobExists, blobFiles, blobLock, blobRead, blobRemove, blobWrite, blobKey } from "./blob";
import { head } from "@vercel/blob";
import type { Asset, Project } from "../../features/wan/types";

export class WanError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
// Runtime-only local user data, never an input to a deployment bundle.
export const dataRoot = () => path.resolve(/* turbopackIgnore: true */ cloudMode() ? requestWorkspace()?.root || path.join(process.env.TMPDIR || "/tmp", "clipmint-wan") : process.env.CLIPMINT_DATA_DIR || path.join(process.cwd(), ".clipmint-data"));
export function localPath(relative: string) {
  const full = path.resolve(dataRoot(), relative);
  if (!full.startsWith(dataRoot() + path.sep)) throw new WanError("Đường dẫn dữ liệu không hợp lệ.");
  return full;
}
export function id(value: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new WanError("ID không hợp lệ.");
  return value;
}
export const relativePath = (file:string) => {
  const relative=path.relative(dataRoot(),file);
  if(relative.startsWith("..") || path.isAbsolute(relative)) throw new WanError("Đường dẫn dữ liệu không hợp lệ.");
  return relative;
};
export async function ensureLocal(file:string) {
  return cloudMode() ? blobDownload(relativePath(file),file) : file;
}
export async function persistFile(file:string) {
  if(cloudMode()) {await blobWrite(relativePath(file),createReadStream(file));requestWorkspace()?.downloaded.add(file);}
}
export async function removeStored(file:string,recursive=false) {
  if(cloudMode())await blobRemove(relativePath(file),recursive);
  await rm(file,{recursive,force:true});requestWorkspace()?.downloaded.delete(file);
}
export async function fileSize(file:string) {
  return cloudMode() ? (await head(blobKey(relativePath(file)))).size : (await stat(file)).size;
}
export async function exists(file: string) { return cloudMode() ? blobExists(relativePath(file)) : stat(file).then(s => s.isFile() && s.size > 0).catch(() => false); }
export async function readJSON<T>(file: string): Promise<T> { return JSON.parse(cloudMode() ? (await blobRead(relativePath(file))).toString("utf8") : await readFile(file, "utf8")) as T; }
export async function atomicJSON(file: string, value: unknown) {
  if(cloudMode())await blobWrite(relativePath(file),JSON.stringify(value,null,2));
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}
export function normalize(value: string) { return value.normalize("NFC").trim().replace(/\s+/g, " "); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => [k, canonical(v)]));
  return typeof value === "string" ? normalize(value) : value;
}
export function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
export function contentHash(data: Buffer) { return createHash("sha256").update(data).digest("hex"); }

// Cross-process exclusive locks. A dead owner's PID can be reclaimed after restart.
// Single local machine/filesystem only; no network filesystem or clustered deployment.
export async function acquireLock(name: string): Promise<null | (() => Promise<void>)> {
  if(cloudMode())return blobLock(id(name));
  const file = localPath("locks/" + id(name) + ".lock");
  await mkdir(path.dirname(file), { recursive: true });
  try { await writeFile(file, String(process.pid), { flag: "wx", mode: 0o600 }); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const pid = Number(await readFile(file, "utf8").catch(() => "0"));
    if (pid) {
      try { process.kill(pid, 0); return null; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") return null; }
    } else return null; // Never reclaim a lock that may still be initializing.
    await rm(file, { force: true });
    return acquireLock(name);
  }
  return () => rm(file, { force: true });
}
export async function locked<T>(name: string, fn: () => Promise<T>): Promise<T> {
  for (let n = 0; n < 200; n++) {
    const release = await acquireLock(name);
    if (release) { try { return await fn(); } finally { await release(); } }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new WanError("Dữ liệu đang được cập nhật. Hãy thử lại.", 409);
}
export async function files(folder: string) {
  if(cloudMode())return blobFiles(folder);
  try { return await readdir(/* turbopackIgnore: true */ localPath(folder)); }
  catch (e) { if ((e as NodeJS.ErrnoException).code==="ENOENT") return []; throw e; }
}
export const projectPath = (projectId: string) => localPath("projects/" + id(projectId) + "/project.json");
export const readProject = (projectId: string) => readJSON<Project>(projectPath(projectId));
export async function saveProject(project: Project) {
  project.revision++; project.updatedAt = new Date().toISOString();
  await atomicJSON(projectPath(project.id), project); return project;
}
export async function createProject(resolution = "720p") {
  const now = new Date().toISOString();
  const p: Project = { id: randomUUID(), revision: 0, createdAt: now, updatedAt: now,
    name: "", features: "", message: "", primaryId: "", mode: "suggest", suggestions: [], scenes: [], assets: [],
    ratio: "9:16", resolution,
    audio: { enabled: false, source: "upload", url: "", audioId: "", musicId: "", text: "", language: "vi", voice: "coral",
      speed: 1, start: 0, end: null, volume: 1, musicVolume: 0.15, subtitles: false, overflow: "trim" } };
  return saveProject(p);
}
export async function listProjects() {
  const result = await Promise.all((await files("projects")).map(p => readProject(p).catch(() => null)));
  return result.filter((p): p is Project => !!p).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function assetById(p: Project, assetId: string, kind?: Asset["kind"]) {
  const a = p.assets.find(a => a.id === assetId);
  if (!a || (kind && a.kind !== kind)) throw new WanError("Chưa chọn file " + (kind || "") + " hợp lệ.");
  return a;
}
export function referenceImages(p: Project, sourceId = p.primaryId) {
  return [assetById(p,sourceId,"image"),...p.assets.filter(a=>a.kind==="image" && a.origin!=="generated" && a.id!==sourceId)].slice(0,8);
}
export async function importAsset(p: Project, file: string, kind: Asset["kind"], mime: string, name: string, duration?: number) {
  const bytes = await readFile(file); const assetId = randomUUID();
  const extension = kind === "image" ? mime === "image/jpeg" ? ".jpg" : mime === "image/webp" ? ".webp" : ".png" : kind === "video" ? ".mp4" : ".m4a";
  const relative = "projects/" + p.id + "/assets/" + assetId + extension;
  await mkdir(path.dirname(localPath(relative)), { recursive: true });
  await copyFile(file, localPath(relative));
  await persistFile(localPath(relative));
  const a: Asset = { id: assetId, name, file: relative, hash: contentHash(bytes), size: bytes.length, mime, kind, duration };
  p.assets.push(a); return a;
}
