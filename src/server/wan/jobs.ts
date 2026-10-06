import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Action, Job, Project, Scene, Settings } from "../../features/wan/types";
import { acquireLock, assetById, atomicJSON, contentHash, ensureLocal, files, hash, id, importAsset, localPath, locked, readJSON, readProject, referenceImages, saveProject, WanError } from "./storage";
import { cloudMode } from "./runtime";
import { getSettings, validateSettings } from "./settings";
import { getCache, cacheOutput, saveCache, type CacheEntry } from "./cache";
import { advertisingCopy, editImage, FalHTTPError, FalJobError, improve, pollVideo, submitVideo, suggest, tts, videoParams } from "./providers";
import { compose, dependencies, extractAudio, probe, validateImage, validateVideo } from "./media";
import { downloadURL } from "./network";

export const jobPath = (jobId: string) => localPath("jobs/" + id(jobId) + ".json");
export async function allJobs(projectId?: string) {
  const result = await Promise.all((await files("jobs")).filter(f=>f.endsWith(".json")).map(f=>readJSON<Job>(localPath("jobs/" + f))));
  return result.filter(j=>!projectId || j.projectId===projectId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
}
export function active(j: Job) { return ["queued","running","polling"].includes(j.status); }
export async function assertIdle(projectId: string) {
  if ((await allJobs(projectId)).some(active)) throw new WanError("Project có job đang chạy. Chờ hoặc chạy lại bước sau khi job kết thúc.",409);
}
export function sceneFor(p: Project, sceneId?: string) {
  const scene=p.scenes.find(s=>s.id===sceneId);
  if (!scene) throw new WanError("Chưa chọn cảnh hợp lệ."); return scene;
}
export function imageKey(s: Settings,p: Project,scene: Scene) {
  const refs = referenceImages(p,scene.sourceId || p.primaryId);
  return hash({version:1,action:"image",provider:"openai",model:s.imageModel,
    inputs:refs.map(a=>a.hash),prompt:scene.prompt,ratio:p.ratio,quality:"medium"});
}
export function videoKey(s: Settings,p: Project,scene: Scene) {
  const source = assetById(p,scene.original ? scene.sourceId : scene.imageId!,"image");
  return hash({version:1,action:"video",provider:"fal.ai",model:s.endpoint,input:source.hash,params:videoParams(s,p,scene)});
}
function parameters(s: Settings,p: Project,action: Action,scene?: Scene) {
  if (action==="video") return videoParams(s,p,scene!);
  return {textModel:s.textModel,imageModel:s.imageModel,ttsModel:s.ttsModel};
}
function inputKey(s: Settings,p: Project,action: Action,scene?: Scene) {
  if (action==="image") return imageKey(s,p,scene!);
  if (action==="video") return videoKey(s,p,scene!);
  const images = referenceImages(p).map(a=>a.hash);
  if (action==="tts") return hash({version:1,action,provider:"openai",model:s.ttsModel,text:p.audio.text,voice:p.audio.voice,speed:p.audio.speed,language:p.audio.language});
  // URL extraction must first download/hash the bytes; URL alone isn't a content cache key.
  if (action==="extract") return hash({version:1,action,url:p.audio.url});
  if (action==="compose") return hash({version:1,action,videos:p.scenes.map(v=>assetById(p,v.videoId!,"video").hash),
    ratio:p.ratio,resolution:p.resolution,audio:p.audio.enabled ? {
      input:assetById(p,p.audio.audioId).hash,music:p.audio.musicId?assetById(p,p.audio.musicId,"music").hash:"",
      start:p.audio.start,end:p.audio.end,volume:p.audio.volume,musicVolume:p.audio.musicVolume,
      subtitles:p.audio.subtitles,narration:p.audio.subtitles?assetById(p,p.audio.audioId).narration:"",overflow:p.audio.overflow,
    } : null});
  return hash({version:1,action,provider:"openai",model:s.textModel,images,name:p.name,features:p.features,message:p.message,
    ...(action==="improve" ? {prompt:scene?.prompt,motion:scene?.motion} : {})});
}
export async function enqueue(projectId: string,action: Action,sceneId?: string,force=false) {
  if (!["suggest","improve","copy","image","video","tts","extract","compose"].includes(action)) throw new WanError("Bước không hợp lệ.");
  return locked("queue",()=>locked("project-" + id(projectId),async()=>{
    const p=await readProject(projectId); const s=await getSettings(); validateSettings(s);
    const scene = ["image","video","improve"].includes(action) ? sceneFor(p,sceneId) : undefined;
    const running=(await allJobs(projectId)).find(active);
    if (running) {
      if (running.action===action && running.sceneId===sceneId) return running;
      throw new WanError("Project đang xử lý bước khác.",409);
    }
    assetById(p,p.primaryId,"image");
    if (["suggest","improve","copy","image","tts"].includes(action) && !s.openaiKey) throw new WanError("Chưa cấu hình OpenAI. Mở Cấu hình AI.");
    if (["image","video"].includes(action)) {
      if (!scene?.prompt.trim() && !scene?.motion.trim()) throw new WanError("Hãy nhập bối cảnh/chuyển động.");
    }
    if (action==="video") {
      if (!s.falKey) throw new WanError("Chưa cấu hình fal.ai API key.");
      if (!scene!.original && (!scene!.imageId || scene!.imageKey!==imageKey(s,p,scene!))) throw new WanError("Tạo và duyệt ảnh bối cảnh hiện tại trước khi gọi Wan.");
    }
    if (action==="tts" && (!p.audio.text.trim() || p.audio.text.length>4000)) throw new WanError("Lời thoại cần 1–4000 ký tự.");
    if (action==="extract") { try { new URL(p.audio.url); } catch { throw new WanError("Hãy nhập URL video."); } }
    if (["video","tts","extract","compose"].includes(action)) {
      if ((await dependencies()).tools.some(t=>!t.available)) throw new WanError("Thiếu FFmpeg/ffprobe. Xem hướng dẫn trong Cấu hình AI.");
    }
    if (action==="compose") {
      if (!p.scenes.length || p.scenes.some(v=>!v.videoId || v.videoKey!==videoKey(s,p,v))) throw new WanError("Một cảnh chưa có video khớp ảnh/prompt/tham số hiện tại. Tạo video cho cảnh đó trước.");
      if (p.audio.enabled) assetById(p,p.audio.audioId,"audio");
      if (p.audio.subtitles && p.audio.enabled && !assetById(p,p.audio.audioId).narration)
        throw new WanError("Phụ đề chỉ khả dụng cho audio giọng AI có lời đã duyệt.");
    }
    const key=inputKey(s,p,action,scene);
    const interrupted=(await allJobs(projectId)).find(j=>j.key===key && j.status==="failed" && j.requestId && !j.providerFailed);
    if (interrupted) {
      interrupted.status="polling"; interrupted.stage="Tạo video · tiếp tục polling";
      interrupted.error=undefined; interrupted.submittedAt=new Date().toISOString();
      await saveJob(interrupted); return interrupted;
    }
    if (!force && (await allJobs(projectId)).some(j=>j.key===key && j.providerFailed))
      throw new WanError("Provider đã báo job thất bại. Bấm Tạo lại video để chủ động gửi job mới (có thể tính phí).");
    const previous=(await allJobs(projectId)).find(j=>j.key===key && j.status==="uncertain");
    if (previous) throw new WanError("Lần submit trước chưa xác định có tính phí hay không. Kiểm tra fal dashboard và khôi phục request ID trước khi tạo lại.",409);
    const now=new Date().toISOString();
    const j: Job = {id:randomUUID(),projectId,sceneId,action,key,status:"queued",stage:"Chuẩn bị",
      createdAt:now,updatedAt:now,snapshot:p,model:action==="video"?s.endpoint:action==="image"?s.imageModel:action==="tts"?s.ttsModel:s.textModel,
      params:parameters(s,p,action,scene),force};
    await atomicJSON(jobPath(j.id),j); return j;
  }));
}
async function saveJob(j: Job) { j.updatedAt=new Date().toISOString(); await atomicJSON(jobPath(j.id),j); }
async function attach(j: Job,entry: CacheEntry) {
  await locked("project-" + j.projectId,async()=>{
    const p=await readProject(j.projectId); const scene=j.sceneId ? sceneFor(p,j.sceneId) : undefined;
    if (j.action==="suggest") p.suggestions=entry.data as Project["suggestions"];
    if (j.action==="copy") p.audio.text=entry.data as string;
    if (j.action==="improve") {
      const result=entry.data as {prompt:string;motion:string}; scene!.prompt=result.prompt; scene!.motion=result.motion;
    }
    if (entry.file) {
      await ensureLocal(localPath(entry.file));
      const kind = j.action==="image" ? "image" : ["tts","extract"].includes(j.action) ? "audio" : "video";
      const info = kind==="image" ? undefined : await probe(localPath(entry.file));
      const a=await importAsset(p,localPath(entry.file),kind,kind==="image"?"image/png":kind==="video"?"video/mp4":"audio/mp4",j.action+"-"+j.id,info?.duration);
      a.origin="generated";
      if (j.action==="tts") a.narration=j.snapshot.audio.text;
      if (j.action==="image") { scene!.imageId=a.id; scene!.imageKey=j.key; }
      if (j.action==="video") { scene!.videoId=a.id; scene!.videoKey=j.key; }
      if (["tts","extract"].includes(j.action)) { p.audio.audioId=a.id; p.audio.start=0; p.audio.end=null; }
      if (j.action==="compose") { p.finalId=a.id; p.finalKey=j.key; }
    }
    await saveProject(p);
  });
  j.result={file:entry.file,data:entry.data}; j.status="succeeded"; j.stage="Hoàn tất"; j.error=undefined; await saveJob(j);
}
export async function processJob(j: Job) {
  const release=await acquireLock("cache-" + j.key); if (!release) return;
  try {
    Object.assign(j,await readJSON<Job>(jobPath(j.id)));
    if(!active(j))return;
    const s=await getSettings();
    // Freeze models at enqueue; current secret keys are read only by the worker.
    if (j.action!=="video") Object.assign(s,j.params);
    if (j.action!=="extract" && !j.force) {
      const cached=await getCache(j.key); if (cached) { j.cached=true; await attach(j,cached); return; }
    }
    const p=j.snapshot;
    const scene=j.sceneId ? sceneFor(p,j.sceneId) : undefined;
    if (j.action==="video") {
      if (!j.requestId) {
        if (j.phase==="submitting") { j.status="uncertain"; j.stage="Submit chưa xác định"; j.error="Worker dừng/mất mạng lúc submit; kiểm tra fal dashboard và khôi phục request ID."; await saveJob(j); return; }
        j.status="running"; j.stage="Tạo video · submit"; j.phase="submitting"; await saveJob(j);
        try {
          const request=await submitVideo(s,j);
          Object.assign(j,request,{phase:"submitted",submittedAt:new Date().toISOString(),status:"polling",stage:"Tạo video · polling"});
          // Persist immediately before any further network request.
          await saveJob(j);
        } catch (e) {
          if (e instanceof FalHTTPError && [400,401,403,404,405,413,422,429].includes(e.httpStatus)) {
            // Definitive rejection: the provider did not accept a generation.
            j.status="failed"; j.phase=undefined; j.stage="Submit bị từ chối"; j.error=e.message;
          } else {
            j.status="uncertain"; j.stage="Submit chưa xác định"; j.error="Không xác nhận được submit. Kiểm tra fal dashboard; không tự submit lại.";
          }
          await saveJob(j); return;
        }
      }
      try {
        const url=await pollVideo(s,j);
        if (!url) {
          const elapsed=Date.now()-Date.parse(j.submittedAt || j.createdAt);
          if (elapsed>s.timeoutSeconds*1000) { j.status="failed"; j.error="Quá thời gian polling. Chạy lại bước để tiếp tục polling cùng request ID."; j.stage="Tạo video · tạm dừng"; }
          await saveJob(j); return;
        }
        j.stage="Tải video về local"; await saveJob(j);
        const file=await cacheOutput(j.key,".mp4"); await writeFile(localPath(file),await downloadURL(url));
        await validateVideo(localPath(file)); const entry={key:j.key,file}; await saveCache(entry); await attach(j,entry);
      } catch (e) {
        // Remain associated with this exact paid job; never enqueue a replacement.
        j.status="failed"; j.providerFailed=e instanceof FalJobError;
        j.error=j.providerFailed ? (e as FalJobError).message : "Polling/download thất bại. Chạy lại bước để tiếp tục với request ID " + j.requestId + ".";
        j.stage=j.providerFailed?"Tạo video · provider thất bại":"Tạo video · tạm dừng"; await saveJob(j);
      }
      return;
    }
    if (j.status==="running" && ["image","tts","suggest","improve","copy"].includes(j.action)) {
      // Non-queue AI APIs don't provide resumable request IDs. Don't silently bill twice.
      j.status="uncertain"; j.error="Worker dừng trong yêu cầu AI. Kiểm tra provider trước khi chủ động thử lại."; j.stage="Yêu cầu AI chưa xác định"; await saveJob(j); return;
    }
    j.status="running"; j.stage=j.action==="image"?"Tạo ảnh bối cảnh":j.action==="compose"?"Ghép video/phụ đề":
      ["tts","extract"].includes(j.action)?"Xử lý audio":"Chuẩn bị · AI"; await saveJob(j);
    let entry: CacheEntry;
    if (j.action==="suggest") entry={key:j.key,data:await suggest(s,p)};
    else if (j.action==="improve") entry={key:j.key,data:await improve(s,p,scene!)};
    else if (j.action==="copy") entry={key:j.key,data:await advertisingCopy(s,p)};
    else if (j.action==="image") {
      const bytes=await editImage(s,p,scene!); await validateImage(bytes);
      const file=await cacheOutput(j.key,".png"); await writeFile(localPath(file),bytes); entry={key:j.key,file};
    } else if (j.action==="tts") {
      const bytes=await tts(s,p); const file=await cacheOutput(j.key,".m4a");
      const temp=localPath("temp/" + j.id + ".mp3"); await mkdir(path.dirname(temp),{recursive:true});
      try { await writeFile(temp,bytes); await extractAudio(temp,localPath(file)); } finally { await rm(temp,{force:true}); }
      entry={key:j.key,file};
    } else if (j.action==="extract") {
      const bytes=await downloadURL(p.audio.url);
      const contentKey=hash({version:1,action:"extract",input:contentHash(bytes),codec:"aac-192k"});
      const cached = j.force ? null : await getCache(contentKey);
      if (cached) { j.cached=true; await attach(j,cached); return; }
      const file=await cacheOutput(contentKey,".m4a"); const temp=localPath("temp/" + j.id + ".input");
      await mkdir(path.dirname(temp),{recursive:true});
      try { await writeFile(temp,bytes); await extractAudio(temp,localPath(file)); } finally { await rm(temp,{force:true}); }
      entry={key:contentKey,file};
    } else {
      const file=await cacheOutput(j.key,".mp4");
      await compose(p,p.scenes.map(v=>assetById(p,v.videoId!,"video")),localPath(file)); entry={key:j.key,file};
    }
    await saveCache(entry); await attach(j,entry);
  } catch (e) {
    j.status="failed"; j.error=e instanceof WanError ? e.message : "Xử lý thất bại. Kiểm tra cấu hình, file input và dependency."; j.stage="Thất bại"; await saveJob(j);
  } finally { await release(); }
}
export async function retryJob(jobId: string,requestId?: string,acknowledgeUncertain=false) {
  return locked("queue",async()=>{
    const j=await readJSON<Job>(jobPath(jobId));
    if (!["failed","uncertain"].includes(j.status)) throw new WanError("Job không ở trạng thái chạy lại.");
    if (j.providerFailed) throw new WanError("Job provider đã kết thúc với lỗi. Chủ động chọn Tạo lại video để gửi một job mới.");
    if ((await allJobs(j.projectId)).some(active)) throw new WanError("Project đang có job khác.",409);
    if (j.status==="uncertain") {
      if (j.action==="video") {
        if (!requestId || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) throw new WanError("Nhập request ID từ fal dashboard để khôi phục job.");
        j.requestId=requestId;
        // Queue lookup uses the model's root namespace, not the sub-endpoint.
        const root=j.model.split("/").slice(0,2).join("/");
        j.statusURL="https://queue.fal.run/" + root + "/requests/" + requestId + "/status";
        j.responseURL="https://queue.fal.run/" + root + "/requests/" + requestId;
        j.phase="submitted";
      } else if (!acknowledgeUncertain) throw new WanError("Xác nhận chủ động gửi lại yêu cầu AI có thể tính phí.");
    }
    j.status=j.requestId?"polling":"queued"; j.stage="Chuẩn bị · chạy lại"; j.error=undefined;
    j.submittedAt=new Date().toISOString(); await saveJob(j); return j;
  });
}
export async function startWorker(signal: AbortSignal) {
  const release=await acquireLock("worker"); if (!release) throw new Error("Another Wan worker is already running");
  const running=new Set<string>(); const lastPolled=new Map<string,number>(); const tasks=new Set<Promise<void>>();
  try {
    while (!signal.aborted) {
      await atomicJSON(localPath("worker.json"),{pid:process.pid,heartbeat:new Date().toISOString()});
      const s=await getSettings();
      await locked("queue",async()=>{
        const jobs=await allJobs();
        // A submitted provider job occupies a slot even between polling requests.
        const admitted=new Set(jobs.filter(j=>["running","polling"].includes(j.status)).map(j=>j.id));
        for (const j of jobs) {
          if (!active(j) || running.has(j.id)) continue;
          if (j.status==="queued" && admitted.size>=s.concurrency) continue;
          if (j.requestId && Date.now()-(lastPolled.get(j.id)||0)<s.pollSeconds*1000) continue;
          admitted.add(j.id);
          running.add(j.id); lastPolled.set(j.id,Date.now());
          const task=processJob(j).finally(()=>{running.delete(j.id);tasks.delete(task);});
          tasks.add(task);
        }
      });
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    await Promise.allSettled(tasks);
  } finally { await release(); await rm(localPath("worker.json"),{force:true}); }
}
// Vercel functions perform one bounded step. Provider rendering continues in fal's
// queue; subsequent ticks/reopening the page resume the stored request ID.
export async function tickJobs(projectId?:string) {
  if(!cloudMode())return;
  const release=await acquireLock("dispatch");if(!release)return;
  try {
    const s=await getSettings();const jobs=await allJobs();
    const admitted=jobs.filter(j=>["running","polling"].includes(j.status)).length;
    const eligible=jobs.filter(j=>active(j) && (j.status!=="queued" || admitted<s.concurrency) &&
      (!j.requestId || Date.now()-Date.parse(j.updatedAt)>=s.pollSeconds*1000));
    const job=eligible.find(j=>j.projectId===projectId) || eligible[0];
    if(job)await processJob(job);
  } finally {await release();}
}
export async function workerStatus() {
  if(cloudMode())return {running:true,mode:"serverless"};
  try {
    const value=await readJSON<{heartbeat:string}>(localPath("worker.json"));
    return {running:Date.now()-Date.parse(value.heartbeat)<10_000};
  } catch { return {running:false}; }
}
