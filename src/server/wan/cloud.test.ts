import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { BlobNotFoundError, BlobPreconditionFailedError, put } from "@vercel/blob";
import { handle } from "./api";
import { acquireLock, atomicJSON, assetById, ensureLocal, exists, localPath, readJSON, readProject } from "./storage";
import { cloudMode, withWorkspace } from "./runtime";
import { blobKey, blobLock, blobPrefix } from "./blob";
import { allJobs, jobPath, videoKey } from "./jobs";
import { getSettings } from "./settings";
import { probe, run } from "./media";
import { downloadURL } from "./network";
import type { Job, Project } from "../../features/wan/types";
const state=vi.hoisted(()=>({data:new Map<string,{bytes:Buffer;etag:string}>(),version:0}));
vi.mock("./network",()=>({downloadURL:vi.fn()}));
vi.mock("@vercel/blob",async importOriginal=>{
  const original=await importOriginal<typeof import("@vercel/blob")>();
  const key=(value:string)=>value.startsWith("https:")?new URL(value).pathname.slice(1):value;
  return {...original,
    put:vi.fn(async(name:string,body:string|Buffer|AsyncIterable<Uint8Array>,options:{ifMatch?:string;allowOverwrite?:boolean})=>{
      const old=state.data.get(name);
      if((options.ifMatch && old?.etag!==options.ifMatch) || (old && !options.ifMatch && !options.allowOverwrite))throw new original.BlobPreconditionFailedError();
      const chunks:Buffer[]=[];
      if(typeof body==="string" || Buffer.isBuffer(body))chunks.push(Buffer.from(body));else for await(const chunk of body)chunks.push(Buffer.from(chunk));
      const etag=String(++state.version);state.data.set(name,{bytes:Buffer.concat(chunks),etag});return {etag,pathname:name,url:"https://blob.test/"+name};
    }),
    get:vi.fn(async(name:string,options?:{headers?:{Range?:string}})=>{
      const entry=state.data.get(key(name));if(!entry)return null;
      let bytes=entry.bytes;const headers=new Headers({"content-length":String(bytes.length)});
      const range=options?.headers?.Range;
      if(range){const match=/bytes=(\d+)-(\d*)/.exec(range)!;const start=+match[1],end=match[2]?Math.min(+match[2],bytes.length-1):bytes.length-1;headers.set("content-range",`bytes ${start}-${end}/${bytes.length}`);bytes=bytes.subarray(start,end+1);headers.set("content-length",String(bytes.length));}
      return {statusCode:200,stream:new Response(new Uint8Array(bytes)).body,headers,blob:{etag:entry.etag,size:bytes.length,pathname:name}};
    }),
    head:vi.fn(async(name:string)=>{const entry=state.data.get(key(name));if(!entry)throw new original.BlobNotFoundError();return {size:entry.bytes.length,etag:entry.etag,contentType:"application/octet-stream"};}),
    list:vi.fn(async({prefix,cursor}:{prefix:string;cursor?:string})=>{
      const entries=[...state.data].filter(([name])=>name.startsWith(prefix));const offset=Number(cursor || 0);const page=entries.slice(offset,offset+2);
      return {blobs:page.map(([pathname,v])=>({pathname,size:v.bytes.length,url:"https://blob.test/"+pathname})),hasMore:offset+2<entries.length,cursor:String(offset+2)};
    }),
    del:vi.fn(async(name:string|string[],options?:{ifMatch?:string})=>{
      for(const value of Array.isArray(name)?name:[name]){const entry=state.data.get(key(value));if(options?.ifMatch && entry?.etag!==options.ifMatch)throw new original.BlobPreconditionFailedError();state.data.delete(key(value));}
    }),
  };
});
vi.mock("@vercel/blob/client",()=>({handleUpload:vi.fn(async({body,onBeforeGenerateToken})=>{
  const rules=await onBeforeGenerateToken(body.payload.pathname,body.payload.clientPayload,false);return {rules};
})}));
let fixture:string;let png:Buffer;let video:Buffer;let speech:Buffer;
beforeAll(async()=>{
  fixture=await mkdtemp(path.join(os.tmpdir(),"wan-cloud-test-"));
  png=await sharp({create:{width:128,height:128,channels:3,background:"green"}}).png().toBuffer();
  await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=c=green:s=90x160:d=0.75","-c:v","libx264","-pix_fmt","yuv420p",path.join(fixture,"clip.mp4")]);
  video=await readFile(path.join(fixture,"clip.mp4"));
  await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","sine=frequency=440:duration=2","-c:a","libmp3lame",path.join(fixture,"speech.mp3")]);
  speech=await readFile(path.join(fixture,"speech.mp3"));
},30000);
beforeEach(()=>{
  state.data.clear();vi.stubEnv("VERCEL","1");vi.stubEnv("BLOB_READ_WRITE_TOKEN","test-blob-token");vi.stubEnv("CLIPMINT_BLOB_PREFIX","test/wan");
  vi.stubEnv("FAL_KEY","test-fal");vi.stubEnv("OPENAI_API_KEY","");vi.mocked(downloadURL).mockResolvedValue(video);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});
afterAll(()=>rm(fixture,{recursive:true,force:true}));
async function request(parts:string[],method="GET",body?:unknown){
  return handle(new Request("https://clipmint.vercel.app/api/wan/"+parts.join("/"),{method,headers:body===undefined?undefined:{"content-type":"application/json",origin:"https://clipmint.vercel.app"},body:body===undefined?undefined:JSON.stringify(body)}),parts);
}
async function product(){
  const response=await request(["projects"],"POST");expect(response.status).toBe(201);let p=(await response.json()).project as Project;
  const pathname=blobPrefix()+"uploads/"+p.id+"/upload-1";
  await put(pathname,png,{access:"private"});
  const uploaded=await request(["projects",p.id,"assets"],"POST",{kind:"image",name:"product.png",pathname});expect(uploaded.status).toBe(201);p=(await uploaded.json()).project;
  const updated=await request(["projects",p.id],"PATCH",{...p,resolution:"480p",scenes:[{id:"scene1",name:"Scene",prompt:"white studio",motion:"camera moves",original:true,sourceId:p.primaryId}]});
  expect(updated.status).toBe(200);return (await updated.json()).project as Project;
}
it("opens on Vercel without localhost rejection and gives actionable missing storage state",async()=>{
  vi.stubEnv("BLOB_READ_WRITE_TOKEN","");
  const response=await request(["settings"]);expect(response.status).toBe(200);const config=await response.json();
  expect(config.storage.configured).toBe(false);expect(config.worker.mode).toBe("serverless");expect(config.dependencies.tools.every((t:{available:boolean})=>t.available)).toBe(true);
  expect((await request(["projects"])).status).toBe(200);
  const blocked=await request(["projects"],"POST");expect(blocked.status).toBe(503);expect((await blocked.json()).error).toContain("Blob store Private");
});
it("persists settings and originals across isolated function workspaces; serves private media ranges",async()=>{
  const saved=await request(["settings"],"PUT",{falKey:"saved-private-key"});expect(saved.status).toBe(200);
  expect(JSON.stringify(await saved.json())).not.toContain("saved-private-key");
  const p=await product();const result=await request(["projects",p.id]);expect((await result.json()).project.primaryId).toBe(p.primaryId);
  expect((await withWorkspace(()=>getSettings())).falKey).toBe("saved-private-key");
  const range=await handle(new Request("https://clipmint.vercel.app/x",{headers:{Range:"bytes=0-9"}}),["projects",p.id,"assets",p.primaryId]);
  expect(range.status).toBe(206);expect((await range.arrayBuffer()).byteLength).toBe(10);
  const cross=await handle(new Request("https://clipmint.vercel.app/x",{headers:{Origin:"https://evil.example"}}),["settings"]);expect(cross.status).toBe(403);
});
it("scopes direct upload tokens to staging, with real size/type constraints",async()=>{
  const p=await product();
  const token=await request(["uploads","token"],"POST",{type:"blob.generate-client-token",payload:{pathname:blobPrefix()+"uploads/"+p.id+"/new-file",clientPayload:JSON.stringify({projectId:p.id,kind:"image"})}});
  expect(token.status).toBe(200);expect((await token.json()).rules.maximumSizeInBytes).toBe(20*1024*1024);
  const invalid=await request(["projects",p.id,"assets"],"POST",{kind:"image",name:"x.png",pathname:blobKey("settings.json")});expect(invalid.status).toBe(400);
});
it("uses conditional distributed locks, reclaims expired leases and preserves a new owner's lease",async()=>{
  const first=await withWorkspace(()=>acquireLock("test-lock"));expect(first).not.toBeNull();
  expect(await withWorkspace(()=>acquireLock("test-lock"))).toBeNull();
  const entry=state.data.get(blobKey("locks/test-lock.json"))!;entry.bytes=Buffer.from(JSON.stringify({expires:0}));
  const replacement=await blobLock("test-lock");expect(replacement).not.toBeNull();await first!();
  expect(state.data.has(blobKey("locks/test-lock.json"))).toBe(true);await replacement!();expect(state.data.has(blobKey("locks/test-lock.json"))).toBe(false);
});
it("resumes the same provider ID after a cold start, deduplicates ticks, caches and composes without Wan calls",async()=>{
  const p=await product();let completed=false;
  const fetcher=vi.fn(async(url:URL|string,init?:RequestInit)=>{
    if(init?.method==="POST")return Response.json({request_id:"cloud-request",status_url:"https://queue.fal.run/fal-ai/wan/requests/cloud-request/status",response_url:"https://queue.fal.run/fal-ai/wan/requests/cloud-request"});
    const jobs=await allJobs(p.id);expect(jobs[0].requestId).toBe("cloud-request");
    return Response.json(String(url).endsWith("/status")?{status:completed?"COMPLETED":"IN_PROGRESS"}:{video:{url:"https://cdn.example/clip.mp4"}});
  });vi.stubGlobal("fetch",fetcher);
  const submissions=await Promise.all([request(["projects",p.id,"jobs"],"POST",{action:"video",sceneId:"scene1"}),request(["projects",p.id,"jobs"],"POST",{action:"video",sceneId:"scene1"})]);
  const ids=await Promise.all(submissions.map(async r=>(await r.json()).job.id));expect(ids[0]).toBe(ids[1]);
  await Promise.all([request(["jobs","tick"],"POST",{projectId:p.id}),request(["jobs","tick"],"POST",{projectId:p.id})]);
  completed=true;
  await withWorkspace(async()=>{const job=await readJSON<Job>(jobPath(ids[0]));expect(job.requestId).toBe("cloud-request");job.updatedAt=new Date(0).toISOString();await atomicJSON(jobPath(job.id),job);});
  expect((await request(["jobs","tick"],"POST",{projectId:p.id})).status).toBe(200);
  let saved=await withWorkspace(()=>readProject(p.id));expect(saved.scenes[0].videoId).toBeTruthy();
  await request(["projects",p.id,"jobs"],"POST",{action:"video",sceneId:"scene1"});await request(["jobs","tick"],"POST",{projectId:p.id});
  expect(fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
  const before=fetcher.mock.calls.length;
  await request(["projects",p.id,"jobs"],"POST",{action:"compose"});expect((await request(["jobs","tick"],"POST",{projectId:p.id})).status).toBe(200);
  saved=await withWorkspace(()=>readProject(p.id));expect(saved.finalId).toBeTruthy();expect(fetcher.mock.calls.length).toBe(before);
  // Change audio only: real bundled FFmpeg, private TTS output and bundled font.
  const originalVideo=saved.scenes[0].videoId;const silentId=saved.finalId;
  await request(["settings"],"PUT",{openaiKey:"test-openai"});
  await request(["projects",p.id],"PATCH",{...saved,audio:{...saved.audio,enabled:true,source:"tts",text:"Đây là sản phẩm màu xanh.",subtitles:true}});
  fetcher.mockImplementation(async()=>new Response(new Uint8Array(speech)));
  await request(["projects",p.id,"jobs"],"POST",{action:"tts"});await request(["jobs","tick"],"POST",{projectId:p.id});
  await request(["projects",p.id,"jobs"],"POST",{action:"compose"});await request(["jobs","tick"],"POST",{projectId:p.id});
  saved=await withWorkspace(()=>readProject(p.id));expect(saved.finalId).not.toBe(silentId);expect(saved.scenes[0].videoId).toBe(originalVideo);
  expect(fetcher.mock.calls.length).toBe(before+1);
  expect((await withWorkspace(()=>allJobs(p.id))).at(-1)?.status).toBe("succeeded");
  const final=assetById(saved,saved.finalId!);await withWorkspace(async()=>expect((await probe(await ensureLocal(localPath(final.file)))).audio).toBe(true));
  expect((await request(["cache"],"DELETE")).status).toBe(200);
  expect(await withWorkspace(()=>exists(localPath(final.file)))).toBe(true);
  expect(await withWorkspace(()=>exists(localPath(assetById(saved,saved.primaryId).file)))).toBe(true);
  expect(cloudMode()).toBe(true);expect(videoKey(await withWorkspace(()=>getSettings()),saved,saved.scenes[0])).toBeTruthy();
},30000);
it("surfaces storage outages rather than treating them as cache misses",async()=>{
  vi.mocked(put).mockRejectedValueOnce(new Error("Blob unavailable"));
  const result=await request(["projects"],"POST");expect(result.status).toBe(500);
  expect(state.data.size).toBe(0);expect(BlobNotFoundError).toBeDefined();expect(BlobPreconditionFailedError).toBeDefined();
});
