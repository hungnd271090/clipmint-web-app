import { createReadStream } from "node:fs";
import { stat, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import type { Action, Asset, Job, Project, Settings } from "../../features/wan/types";
import { capabilities } from "../../features/wan/types";
import { allJobs, assertIdle, enqueue, retryJob, workerStatus } from "./jobs";
import { cacheStats, clearCache } from "./cache";
import { getSettings, publicSettings, putSettings, validateSettings } from "./settings";
import { assetById, createProject, importAsset, listProjects, localPath, locked, readProject, saveProject, WanError } from "./storage";
import { dependencies, extractAudio, validateImage } from "./media";
import { updateProject } from "./projects";

export function publicJob(j: Job) {
  return Object.fromEntries(Object.entries(j).filter(([key])=>!["snapshot","params","result"].includes(key)));
}
async function responseProject(project: Project) {
  return {project,jobs:(await allJobs(project.id)).map(publicJob)};
}
const json=(data: unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
async function bodyJSON(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json")) throw new WanError("Cần Content-Type application/json.");
  const bytes=await limited(req,1_000_000);
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new WanError("JSON không hợp lệ."); }
}
async function limited(req: Request,limit: number) {
  if (Number(req.headers.get("content-length"))>limit) throw new WanError("Request quá lớn.",413);
  const reader=req.body?.getReader(); if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[]=[]; let total=0;
  try {
    while (true) {
      const {done,value}=await reader.read(); if (done) break;
      total+=value.length; if (total>limit) { await reader.cancel(); throw new WanError("Request quá lớn.",413); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
function localOnly(req: Request) {
  const url=new URL(req.url); const requestHost=req.headers.get("host") || url.host;
  const host=new URL("http://" + requestHost).hostname;
  const allowed=["localhost","127.0.0.1","[::1]",...(process.env.CLIPMINT_LOCAL_HOSTS || "").split(",").filter(Boolean)];
  if (!allowed.includes(host)) throw new WanError("Wan backend chỉ chạy local. Dùng http://localhost:3000 và npm run dev:wan; không hỗ trợ serverless.",403);
  const origin=req.headers.get("origin");
  if ((origin && new URL(origin).host!==requestHost) || req.headers.get("sec-fetch-site")==="cross-site") throw new WanError("Origin không hợp lệ.",403);
}
export async function handle(req: Request,parts: string[]): Promise<Response> {
  try {
    localOnly(req);
    const method=req.method;
    if (parts.length===1 && parts[0]==="settings") {
      if (method==="GET") return json({settings:publicSettings(await getSettings()),capabilities,dependencies:await dependencies(),worker:await workerStatus()});
      if (method==="PUT") return json({settings:await putSettings(await bodyJSON(req) as Partial<Settings>)});
    }
    if (parts.join("/")==="settings/test" && method==="POST") {
      validateSettings(await getSettings());
      return json({dependencies:await dependencies(),worker:await workerStatus(),
        message:"Đã kiểm tra schema/cấu hình local và dependency. Không tạo video/ảnh/giọng, không xác minh key/quota bằng inference. Chưa có kiểm tra key fal miễn phí phù hợp được xác minh; xem fal dashboard để kiểm tra quyền và số dư."});
    }
    if (parts.length===1 && parts[0]==="cache") {
      if (method==="GET") return json(await cacheStats());
      if (method==="DELETE") return json(await clearCache());
    }
    if (parts.length===1 && parts[0]==="projects") {
      if (method==="GET") return json({projects:(await listProjects()).map(p=>({id:p.id,name:p.name,updatedAt:p.updatedAt}))});
      if (method==="POST") return json(await responseProject(await createProject((await getSettings()).resolution)),201);
    }
    if (parts[0]==="jobs" && parts[2]==="retry" && method==="POST") {
      const input=await bodyJSON(req);
      return json({job:publicJob(await retryJob(parts[1],input.requestId,input.acknowledgeUncertain===true))});
    }
    if (parts[0]==="projects" && parts[1]) {
      const projectId=parts[1];
      if (parts.length===2) {
        if (method==="GET") return json(await responseProject(await readProject(projectId)));
        if (method==="PATCH") return json(await responseProject(await updateProject(projectId,await bodyJSON(req))));
      }
      if (parts[2]==="jobs" && method==="POST") {
        const input=await bodyJSON(req);
        return json({job:publicJob(await enqueue(projectId,input.action as Action,input.sceneId,input.force===true))},202);
      }
      if (parts[2]==="assets" && parts.length===3 && method==="POST") {
        const type=req.headers.get("content-type") || "";
        if (!type.startsWith("multipart/form-data;")) throw new WanError("Cần multipart/form-data.");
        const bytes=await limited(req,105*1024*1024);
        const form=await new Response(new Uint8Array(bytes),{headers:{"Content-Type":type}}).formData();
        const kind=String(form.get("kind") || "image") as Asset["kind"];
        if (!["image","audio","music"].includes(kind)) throw new WanError("Loại file không hợp lệ.");
        const file=form.get("file");
        if (!(file instanceof File) || !file.size) throw new WanError("Chưa chọn file.");
        if (file.size>(kind==="image"?20:100)*1024*1024) throw new WanError("Ảnh tối đa 20MB, audio tối đa 100MB.",413);
        return locked("project-" + projectId,async()=>{
          await assertIdle(projectId); const p=await readProject(projectId);
          if (kind==="image" && p.assets.filter(a=>a.kind==="image" && a.origin!=="generated").length>=12) throw new WanError("Tối đa 12 ảnh gốc.");
          const data=Buffer.from(await file.arrayBuffer());
          const temp=localPath("temp/" + randomUUID() + ".input"); await mkdir(path.dirname(temp),{recursive:true});
          await writeFile(temp,data);
          const normalized=temp+".m4a";
          try {
            let mime:string; let duration:number|undefined; let source=temp;
            if (kind==="image") mime=await validateImage(data);
            else {
              if (!/\.(mp3|wav|m4a)$/i.test(file.name)) throw new WanError("Chỉ hỗ trợ MP3, WAV, M4A.");
              duration=await extractAudio(temp,normalized); mime="audio/mp4"; source=normalized;
            }
            const a=await importAsset(p,source,kind,mime,path.basename(file.name).slice(0,200),duration);
            a.origin="upload";
            if (kind==="image" && !p.primaryId) p.primaryId=a.id;
            if (kind==="audio") {p.audio.audioId=a.id;p.audio.start=0;p.audio.end=null;}
            if (kind==="music") p.audio.musicId=a.id;
            await saveProject(p); return json(await responseProject(p),201);
          } finally { await rm(temp,{force:true}); await rm(normalized,{force:true}); }
        });
      }
      if (parts[2]==="assets" && parts[3]) {
        if (method==="DELETE") return locked("project-" + projectId,async()=>{
          await assertIdle(projectId); const p=await readProject(projectId); const a=assetById(p,parts[3]);
          if (p.scenes.some(s=>[s.sourceId,s.imageId,s.videoId].includes(a.id)) || [p.audio.audioId,p.audio.musicId,p.finalId].includes(a.id)) throw new WanError("File đang được cảnh/audio sử dụng. Bỏ lựa chọn đó trước khi xóa.",409);
          p.assets=p.assets.filter(v=>v.id!==a.id);
          if (p.primaryId===a.id) p.primaryId=p.assets.find(v=>v.kind==="image")?.id || "";
          await saveProject(p); await rm(localPath(a.file),{force:true}); return json(await responseProject(p));
        });
        if (method==="GET") {
          const a=assetById(await readProject(projectId),parts[3]); const file=localPath(a.file); const info=await stat(file);
          let start=0; let end=info.size-1; const range=req.headers.get("range");
          if (range) {
            const match=/^bytes=(\d*)-(\d*)$/.exec(range);
            if (!match || (!match[1] && !match[2])) return new Response(null,{status:416,headers:{"Content-Range":"bytes */"+info.size}});
            if (!match[1]) start=Math.max(0,info.size-Number(match[2]));
            else { start=Number(match[1]); end=match[2]?Math.min(Number(match[2]),end):end; }
            if (start>end || start>=info.size) return new Response(null,{status:416,headers:{"Content-Range":"bytes */"+info.size}});
          }
          const stream=Readable.toWeb(createReadStream(file,{start,end})) as ReadableStream<Uint8Array>;
          return new Response(stream,{status:range?206:200,headers:{
            "Content-Type":a.mime,"Content-Length":String(end-start+1),"Accept-Ranges":"bytes",
            "Cache-Control":"private, no-store",...(range?{"Content-Range":"bytes "+start+"-"+end+"/"+info.size}:{}),
            ...(new URL(req.url).searchParams.has("download")?{"Content-Disposition":'attachment; filename="clipmint-'+a.id+(a.kind==="video"?'.mp4"':a.kind==="image"?'.png"':'.m4a"')}:{})
          }});
        }
      }
    }
    return json({error:"Route không tồn tại."},404);
  } catch (e) {
    if (e instanceof WanError) return json({error:e.message},e.status);
    if ((e as NodeJS.ErrnoException).code==="ENOENT") return json({error:"Project/file không còn tồn tại."},404);
    return json({error:e instanceof Error && e.message.startsWith("Có job") ? e.message : "Yêu cầu thất bại. Kiểm tra dữ liệu local và cấu hình."},500);
  }
}
