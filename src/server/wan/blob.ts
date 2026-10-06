import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { BlobNotFoundError, BlobPreconditionFailedError, del, get, head, list, put } from "@vercel/blob";
import { cloudConfigured, requestWorkspace } from "./runtime";

export function blobPrefix() {
  const configured=process.env.CLIPMINT_BLOB_PREFIX;
  const preview=process.env.VERCEL_ENV==="preview" ? "/preview-"+createHash("sha256").update(process.env.VERCEL_GIT_COMMIT_REF || "preview").digest("hex").slice(0,12) : "";
  const prefix=configured || "clipmint/wan/v1"+preview;
  if (!/^[a-zA-Z0-9_/-]+$/.test(prefix) || prefix.split("/").includes("..")) throw new Error("CLIPMINT_BLOB_PREFIX không hợp lệ.");
  return prefix.replace(/\/+$/,"")+"/";
}
export function assertBlob() {
  if (!cloudConfigured()) throw Object.assign(new Error("Vercel: tạo Blob store Private trong Storage, kết nối project để có BLOB_READ_WRITE_TOKEN rồi Redeploy. Không cần chạy worker local."),{status:503});
}
export const blobKey=(relative:string)=>blobPrefix()+relative.replaceAll(path.sep,"/");
export const missing=()=>Object.assign(new Error("File không tồn tại."),{code:"ENOENT"});
export async function blobRead(relative:string) {
  assertBlob();
  const result=await get(blobKey(relative),{access:"private",useCache:false});
  if (!result || !result.stream) throw missing();
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}
export async function blobWrite(relative:string,body:string|ReturnType<typeof createReadStream>) {
  assertBlob();
  await put(blobKey(relative),body,{access:"private",allowOverwrite:true,addRandomSuffix:false,cacheControlMaxAge:60});
}
export async function blobExists(relative:string) {
  assertBlob();
  try { return (await head(blobKey(relative))).size>0; }
  catch(e) { if (e instanceof BlobNotFoundError) return false; throw e; }
}
export async function blobEntries(relative:string) {
  assertBlob(); const prefix=blobKey(relative.replace(/\/+$/,"")+"/");
  const result: {pathname:string;size:number;url:string}[]=[];
  let cursor:string|undefined;
  do {const page=await list({prefix,cursor,limit:1000});result.push(...page.blobs);cursor=page.hasMore?page.cursor:undefined;} while(cursor);
  return result;
}
export async function blobFiles(relative:string) {
  const prefix=blobKey(relative.replace(/\/+$/,"")+"/");
  return [...new Set((await blobEntries(relative)).map(b=>b.pathname.slice(prefix.length).split("/")[0]))];
}
export async function blobRemove(relative:string,recursive=false) {
  assertBlob();
  if(recursive){const entries=await blobEntries(relative);for(let i=0;i<entries.length;i+=500)await del(entries.slice(i,i+500).map(b=>b.url));}
  else await del(blobKey(relative));
}
export async function blobDownload(relative:string,file:string) {
  if(requestWorkspace()?.downloaded.has(file)) return file;
  const data=await blobRead(relative);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,data);
  requestWorkspace()?.downloaded.add(file);return file;
}
// Conditional creation and ETag replacement serialize across distinct function instances.
// Leases outlast the route's 300s execution budget; interrupted submissions stay uncertain.
export async function blobLock(name:string):Promise<null|(()=>Promise<void>)> {
  assertBlob();const key=blobKey("locks/"+name+".json");
  let etag:string;
  const content=JSON.stringify({expires:Date.now()+330_000});
  try { etag=(await put(key,content,{access:"private",addRandomSuffix:false,allowOverwrite:false,cacheControlMaxAge:60})).etag; }
  catch(e) {
    // Read the latest lock; absence/network errors must not be interpreted as ownership.
    const current=await get(key,{access:"private",useCache:false});
    if(!current?.stream) throw e;
    const value=await new Response(current.stream).json();
    if(!Number.isFinite(value.expires) || value.expires>Date.now()) return null;
    try {etag=(await put(key,content,{access:"private",ifMatch:current.blob.etag,addRandomSuffix:false,cacheControlMaxAge:60})).etag;}
    catch(error){if(error instanceof BlobPreconditionFailedError)return null;throw error;}
  }
  return async()=>{try{await del(key,{ifMatch:etag});}catch(e){if(!(e instanceof BlobPreconditionFailedError) && !(e instanceof BlobNotFoundError))throw e;}};
}
