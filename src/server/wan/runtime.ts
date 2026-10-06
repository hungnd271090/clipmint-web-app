import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const cloudMode = () => process.env.VERCEL === "1" || process.env.CLIPMINT_STORAGE === "vercel-blob";
export const cloudConfigured = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const context = new AsyncLocalStorage<{root:string;downloaded:Set<string>}>();
export const requestWorkspace = () => context.getStore();
export async function withWorkspace<T>(fn:()=>Promise<T>) {
  if (!cloudMode()) return fn();
  const root=await mkdtemp(path.join(os.tmpdir(),"clipmint-wan-"));
  try { return await context.run({root,downloaded:new Set()},fn); }
  finally { await rm(root,{recursive:true,force:true}); }
}
