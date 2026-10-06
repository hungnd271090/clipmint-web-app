import type { Action, Asset, Job, Project, Scene, Settings, PublicSettings } from "../types";
import { defaults } from "../defaults";
import { videoParams } from "../prompts";
import { bytesHash, cacheHash, DirectoryStore } from "./disk";
import { media } from "./media";
interface Entry {jobId?:string;key:string;file?:string;data?:unknown;mime?:string;duration?:number}
const active=(j:Job)=>["queued","running","polling"].includes(j.status);
const now=()=>new Date().toISOString();
const paid=(a:Action)=>["suggest","improve","copy","image","tts","video"].includes(a);
class ProviderError extends Error {constructor(message:string,public definitive=false,public providerFailed=false){super(message);}}
const asset=(p:Project,id:string,kind?:Asset["kind"])=>{const a=p.assets.find(v=>v.id===id);if(!a || kind && a.kind!==kind)throw new Error("Chưa chọn file "+(kind||"")+" hợp lệ.");return a;};
const scene=(p:Project,id?:string)=>{const s=p.scenes.find(v=>v.id===id);if(!s)throw new Error("Chưa chọn cảnh.");return s;};
const refs=(p:Project,id=p.primaryId)=>[asset(p,id,"image"),...p.assets.filter(a=>a.kind==="image" && a.origin!=="generated" && a.id!==id)].slice(0,8);
async function checkImage(blob:Blob){
  const bytes=new Uint8Array(await blob.slice(0,16).arrayBuffer());
  const mime=bytes[0]===255 && bytes[1]===216?"image/jpeg":bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71?"image/png":new TextDecoder().decode(bytes.slice(0,4))==="RIFF" && new TextDecoder().decode(bytes.slice(8,12))==="WEBP"?"image/webp":"";
  if(!mime)throw new Error("Chỉ JPEG, PNG, WebP.");
  const bitmap=await createImageBitmap(blob);try{if(bitmap.width<64||bitmap.height<64||bitmap.width*bitmap.height>40_000_000)throw new Error("Ảnh tối thiểu 64px và tối đa 40 megapixel.");}finally{bitmap.close();}return mime;
}
export class BrowserStudio {
  disk=new DirectoryStore();private urls=new Map<string,string>();private environment?:PublicSettings;private runtimeTools?:Promise<{name:string;available:boolean}[]>;
  async initialize(){await this.disk.restore();}
  dispose(){this.urls.forEach(u=>URL.revokeObjectURL(u));this.urls.clear();}
  async select(reconnect=false){await this.disk.pick(reconnect);this.dispose();}
  assetURL(p:Project,id:string){return this.urls.get(asset(p,id).file)||"";}
  async hydrate(p:Project){for(const a of p.assets){if(!this.urls.has(a.file)){try{this.urls.set(a.file,URL.createObjectURL(await this.disk.read(a.file)));}catch(e){if(e instanceof DOMException && e.name==="NotFoundError")continue;throw e;}}}return p;}
  private async proxy(action:string,body:unknown,binary=false){
    const r=await fetch("/api/wan-provider/"+action,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"});
    if(!r.ok){const b=await r.json().catch(()=>({}));throw new ProviderError(b.error||"Provider/proxy HTTP "+r.status,b.definitive,b.providerFailed);}
    return binary?r.blob():r.json();
  }
  private async config(){
    if(!this.environment){const r=await fetch("/api/wan-provider/config",{cache:"no-store"});if(!r.ok)throw new Error("Không đọc được cấu hình AI proxy.");this.environment=(await r.json()).settings;}
    const s=await this.settings();const {falKey,openaiKey,...safe}=s;
    this.runtimeTools??=typeof window==="undefined"?Promise.resolve([{name:"FFmpeg WASM",available:true}]):Promise.all(["ffmpeg-core.js","ffmpeg-core.wasm","DejaVuSans.ttf"].map(async name=>({name,available:await fetch("/ffmpeg/"+name,{method:"HEAD"}).then(r=>r.ok).catch(()=>false)})));
    const tools=await this.runtimeTools;
    return {settings:{...safe,falConfigured:!!falKey||!!this.environment?.falConfigured,openaiConfigured:!!openaiKey||!!this.environment?.openaiConfigured,falKeyMasked:falKey||this.environment?.falConfigured?"••••••••":"",openaiKeyMasked:openaiKey||this.environment?.openaiConfigured?"••••••••":""},
      storage:{mode:"browser-directory",configured:!!this.disk.root,instructions:"Chọn thư mục trên máy để lưu project, media và cache. Không cần Vercel Blob."},
      worker:{running:true,mode:"browser"},dependencies:{tools,instructions:"Thiếu file FFmpeg WASM/font. Chạy npm install (postinstall copy-ffmpeg-core), build và redeploy; reload trình duyệt."}};
  }
  private async settings():Promise<Settings>{return {...defaults,...(this.disk.root?await this.disk.json<Settings>("settings.json"):null)};}
  private async project(id:string){const p=await this.disk.json<Project>("projects/"+id+"/project.json");if(!p)throw new Error("Không tìm thấy project trong thư mục đã chọn.");return p;}
  private async saveProject(p:Project){p.revision++;p.updatedAt=now();await this.disk.writeJSON("projects/"+p.id+"/project.json",p);return p;}
  private async jobs(projectId?:string){const all=await Promise.all((await this.disk.list("jobs")).filter(n=>n.endsWith(".json")).map(n=>this.disk.json<Job>("jobs/"+n)));return all.filter((j):j is Job=>!!j&&(!projectId||j.projectId===projectId));}
  private async saveJob(j:Job){j.updatedAt=now();await this.disk.writeJSON("jobs/"+j.id+".json",j);}
  private async response(p:Project){return {project:await this.hydrate(p),jobs:await this.jobs(p.id)};}
  private async idle(id:string){if((await this.jobs(id)).some(active))throw new Error("Project có job đang chạy.");}
  private async importAsset(p:Project,blob:Blob,kind:Asset["kind"],name:string,duration?:number,origin:Asset["origin"]="generated"){
    const id=crypto.randomUUID(),extension=kind==="image"?(blob.type==="image/jpeg"?".jpg":blob.type==="image/webp"?".webp":".png"):kind==="video"?".mp4":".m4a";
    const file="projects/"+p.id+"/assets/"+id+extension;await this.disk.write(file,blob);
    const a:Asset={id,file,kind,name,mime:blob.type,size:blob.size,hash:await bytesHash(await blob.arrayBuffer()),duration,origin};p.assets.push(a);this.urls.set(file,URL.createObjectURL(blob));return a;
  }
  private async cached(key:string):Promise<Entry|null>{const e=await this.disk.json<Entry>("cache/"+key+".json");if(e?.file){try{await this.disk.read(e.file);}catch(error){if(error instanceof DOMException && error.name==="NotFoundError")return null;throw error;}}return e;}
  private async cacheBlob(key:string,blob:Blob,duration?:number):Promise<Entry>{const file="cache/"+key+".bin";await this.disk.write(file,blob);return {key,file,mime:blob.type,duration};}
  async key(s:Settings,p:Project,action:Action,v?:Scene,inputHash?:string){
    const base={version:2,action};
    if(action==="image")return cacheHash({...base,provider:"openai",model:s.imageModel,inputs:refs(p,v!.sourceId).map(a=>a.hash),prompt:v!.prompt,ratio:p.ratio,quality:"medium",compression:"jpeg-1536-300k-v1"});
    if(action==="video")return cacheHash({...base,provider:"fal.ai",model:s.endpoint,input:asset(p,v!.original?v!.sourceId:v!.imageId!,"image").hash,params:videoParams(s,p,v!),compression:"jpeg-1536-300k-v1"});
    if(action==="tts")return cacheHash({...base,provider:"openai",model:s.ttsModel,text:p.audio.text,voice:p.audio.voice,speed:p.audio.speed,language:p.audio.language});
    if(action==="extract")return cacheHash({...base,input:inputHash||p.audio.url,codec:"aac-192k"});
    if(action==="compose")return cacheHash({...base,videos:p.scenes.map(v=>asset(p,v.videoId!,"video").hash),ratio:p.ratio,resolution:p.resolution,audio:p.audio.enabled?{input:asset(p,p.audio.audioId,"audio").hash,music:p.audio.musicId?asset(p,p.audio.musicId,"music").hash:"",start:p.audio.start,end:p.audio.end,volume:p.audio.volume,musicVolume:p.audio.musicVolume,subtitles:p.audio.subtitles,narration:p.audio.subtitles?asset(p,p.audio.audioId).narration:"",overflow:p.audio.overflow}:null});
    return cacheHash({...base,provider:"openai",model:s.textModel,inputs:refs(p).map(a=>a.hash),name:p.name,features:p.features,message:p.message,...(action==="improve"?{prompt:v?.prompt,motion:v?.motion}:{}),compression:"jpeg-1536-300k-v1"});
  }
  private async enqueue(id:string,action:Action,sceneId?:string,force=false){
    return this.disk.lock("queue",()=>this.disk.lock("project-"+id,async()=>{
      if(!["suggest","improve","copy","image","video","tts","extract","compose"].includes(action))throw new Error("Bước không hợp lệ.");
      const p=await this.project(id),s=await this.settings(),conf=await this.config();const previous=await this.jobs(id);
      const running=previous.find(active);if(running){if(running.action===action&&running.sceneId===sceneId)return running;throw new Error("Project đang xử lý bước khác.");}
      asset(p,p.primaryId,"image");const v=["image","video","improve"].includes(action)?scene(p,sceneId):undefined;
      if(paid(action) && !(action==="video"?conf.settings.falConfigured:conf.settings.openaiConfigured))throw new Error("Chưa cấu hình key. Mở Cấu hình AI.");
      if(["image","video"].includes(action)&&!v!.prompt.trim()&&!v!.motion.trim())throw new Error("Nhập bối cảnh/chuyển động trước.");
      if(action==="video" && !v!.original && (!v!.imageId||v!.imageKey!==await this.key(s,p,"image",v)))throw new Error("Tạo và duyệt ảnh bối cảnh khớp prompt trước.");
      if(action==="compose"){
        if(!p.scenes.length)throw new Error("Chưa có cảnh.");
        for(const v of p.scenes)if(!v.videoId||v.videoKey!==await this.key(s,p,"video",v))throw new Error("Cảnh chưa có video khớp ảnh/prompt/tham số. Chủ động tạo cảnh trước.");
      }
      const key=await this.key(s,p,action,v);
      const interrupted=previous.find(j=>j.key===key && j.requestId && j.status==="failed"&&!j.providerFailed);
      if(interrupted){interrupted.status="polling";interrupted.error=undefined;interrupted.submittedAt=now();await this.saveJob(interrupted);return interrupted;}
      if(previous.some(j=>j.key===key&&j.status==="uncertain"))throw new Error("Submit chưa xác định. Khôi phục request ID hoặc xác nhận thử lại ở mục Tiến trình.");
      if(!force&&previous.some(j=>j.key===key&&j.providerFailed))throw new Error("Provider đã báo thất bại; bấm Tạo lại để chủ động gửi job mới.");
      const {falKey:_fal,openaiKey:_openai,...params}=s;void _fal;void _openai;
      const j:Job={id:crypto.randomUUID(),projectId:id,sceneId,action,key,status:"queued",stage:"Chuẩn bị",createdAt:now(),updatedAt:now(),snapshot:p,model:action==="video"?s.endpoint:action==="image"?s.imageModel:action==="tts"?s.ttsModel:s.textModel,params,force};await this.saveJob(j);return j;
    }));
  }
  private async imagePayload(p:Project,action:Action,v?:Scene){
    if(["tts","compose","extract"].includes(action))return [];
    const images=action==="video"?[asset(p,v!.original?v!.sourceId:v!.imageId!,"image")]:refs(p,action==="image"?v!.sourceId:p.primaryId);
    return Promise.all(images.map(async a=>{
      const bitmap=await createImageBitmap(await this.disk.read(a.file));
      try{
        const factor=Math.min(1,1536/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement("canvas");canvas.width=Math.round(bitmap.width*factor);canvas.height=Math.round(bitmap.height*factor);const ctx=canvas.getContext("2d")!;ctx.fillStyle="white";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
        let blob:Blob|null=null;for(const quality of [0.85,0.65,0.45,0.25]){blob=await new Promise(r=>canvas.toBlob(r,"image/jpeg",quality));if(blob && blob.size<=300_000)break;}if(!blob||blob.size>300_000)throw new Error("Ảnh quá phức tạp để gửi provider. Dùng ảnh nhỏ hơn.");
        const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("Không đọc được ảnh."));reader.readAsDataURL(blob!);});return {id:a.id,data};
      }finally{bitmap.close();}
    }));
  }
  private async attach(j:Job,e:Entry){
    await this.disk.lock("project-"+j.projectId,async()=>{
      const p=await this.project(j.projectId),v=j.sceneId?scene(p,j.sceneId):undefined;
      if(j.action==="suggest")p.suggestions=e.data as Project["suggestions"];
      if(j.action==="copy")p.audio.text=e.data as string;
      if(j.action==="improve")Object.assign(v!,e.data);
      if(e.file){
        const kind=j.action==="image"?"image":["tts","extract"].includes(j.action)?"audio":"video";
        const a=await this.importAsset(p,new Blob([await this.disk.read(e.file)],{type:e.mime}),kind,j.action+"-"+j.id,e.duration);
        if(j.action==="tts")a.narration=j.snapshot.audio.text;
        if(j.action==="image"){v!.imageId=a.id;v!.imageKey=j.key;}
        if(j.action==="video"){v!.videoId=a.id;v!.videoKey=j.key;}
        if(["tts","extract"].includes(j.action)){p.audio.audioId=a.id;p.audio.start=0;p.audio.end=null;}
        if(j.action==="compose"){p.finalId=a.id;p.finalKey=j.key;}
      }
      await this.saveProject(p);
    });
    j.result={file:e.file,data:e.data};j.status="succeeded";j.stage="Hoàn tất";j.error=undefined;await this.saveJob(j);
  }
  private async process(id:string){
    const initial=await this.disk.json<Job>("jobs/"+id+".json");if(!initial)return;
    await this.disk.lock("cache-"+initial.key,async()=>{
      const j=await this.disk.json<Job>("jobs/"+id+".json");if(!j||!active(j))return;
      const s={...await this.settings(),...j.params} as Settings;const p=j.snapshot,v=j.sceneId?scene(p,j.sceneId):undefined;
      try{
        // If saving/attaching was interrupted, the already-written result is reused even for forced jobs.
        const completed=await this.cached(j.key);if(completed && (j.result || completed.jobId===j.id)){await this.attach(j,completed);return;}
        if(!j.force&&j.action!=="extract"){const e=await this.cached(j.key);if(e){j.cached=true;await this.attach(j,e);return;}}
        if(j.action==="video"){
          if(!j.requestId && !j.force){
            const shared=(await this.jobs()).find(other=>other.id!==j.id && other.key===j.key && (other.requestId || other.phase==="submitting"));
            if(shared){if(shared.requestId){j.requestId=shared.requestId;j.phase="submitted";j.status="polling";j.stage="Tạo video · dùng cùng job provider";j.submittedAt=shared.submittedAt;await this.saveJob(j);}else{j.status="uncertain";j.stage="Submit chưa xác định";j.error="Có job cùng input đang submit/chưa xác định. Kiểm tra fal dashboard, khôi phục ID trước khi gọi mới.";await this.saveJob(j);return;}}
          }
          if(!j.requestId){
            if(j.phase==="submitting"){j.status="uncertain";j.stage="Submit chưa xác định";j.error="Tab đóng/mất mạng lúc submit. Khôi phục request ID từ fal dashboard; không tự submit lại.";await this.saveJob(j);return;}
            // Prepare references before recording the irreversible submit boundary.
            const images=await this.imagePayload(p,j.action,v);
            j.phase="submitting";j.status="running";j.stage="Tạo video · submit";await this.saveJob(j);
            try{Object.assign(j,await this.proxy("submit",{settings:s,project:p,sceneId:j.sceneId,images}),{phase:"submitted",status:"polling",stage:"Tạo video · polling",submittedAt:now()});await this.saveJob(j);}
            catch(e){j.status=e instanceof ProviderError&&e.definitive?"failed":"uncertain";j.stage="Submit chưa hoàn tất";j.error=e instanceof Error?e.message:"Không xác định submit.";if(j.status==="failed")j.phase=undefined;await this.saveJob(j);return;}
          }
          if(Date.now()-Date.parse(j.updatedAt)<s.pollSeconds*1000)return;
          if(Date.now()-Date.parse(j.submittedAt||j.createdAt)>s.timeoutSeconds*1000)throw new Error("Quá thời gian polling. Chạy lại bước để tiếp tục cùng request ID.");
          const result=await this.proxy("poll",{settings:s,requestId:j.requestId});
          if(!result.url){await this.saveJob(j);return;}
          j.stage="Tải và kiểm tra video trên máy";await this.saveJob(j);
          const blob:Blob=await this.proxy("download",{url:result.url},true);
          const info=(await media({action:"probe",files:[{name:"input",buffer:await blob.arrayBuffer()}]})).info;
          const entry=await this.cacheBlob(j.key,new Blob([blob],{type:"video/mp4"}),info.duration);entry.jobId=j.id;await this.disk.writeJSON("cache/"+j.key+".json",entry);j.result={file:entry.file};await this.saveJob(j);await this.attach(j,entry);return;
        }
        if(j.status==="running" && paid(j.action)){
          j.status="uncertain";j.stage="Yêu cầu AI chưa xác định";j.error="Tab đóng khi gọi AI. Kiểm tra provider rồi xác nhận thử lại; không tự gọi trả phí mới.";await this.saveJob(j);return;
        }
        const images=await this.imagePayload(p,j.action,v);
        j.status="running";j.stage=j.action==="image"?"Tạo ảnh bối cảnh":j.action==="compose"?"Ghép video/phụ đề trên máy":["tts","extract"].includes(j.action)?"Xử lý audio trên máy":"Chuẩn bị · AI";await this.saveJob(j);
        let entry:Entry;
        if(["suggest","improve","copy"].includes(j.action)){const r=await this.proxy(j.action,{settings:s,project:p,sceneId:j.sceneId,images});entry={key:j.key,data:r.data};}
        else if(j.action==="image"){const blob:Blob=await this.proxy("image",{settings:s,project:p,sceneId:j.sceneId,images},true);await checkImage(blob);entry=await this.cacheBlob(j.key,blob);}
        else if(j.action==="tts"){
          const blob:Blob=await this.proxy("tts",{settings:s,project:p,images:[]},true);const result=await media({action:"extract",files:[{name:"input",buffer:await blob.arrayBuffer()}]});entry=await this.cacheBlob(j.key,result.blob!,result.info.duration);
        }else if(j.action==="extract"){
          const blob:Blob=await this.proxy("download",{url:p.audio.url},true);j.key=await this.key(s,p,j.action,undefined,await bytesHash(await blob.arrayBuffer()));await this.saveJob(j);
          const cached=!j.force?await this.cached(j.key):null;if(cached){j.cached=true;await this.attach(j,cached);return;}
          const result=await media({action:"extract",files:[{name:"input",buffer:await blob.arrayBuffer()}]});entry=await this.cacheBlob(j.key,result.blob!,result.info.duration);
        }else{
          const files=await Promise.all(p.scenes.map(async(v,i)=>({name:"video-"+i,buffer:await (await this.disk.read(asset(p,v.videoId!,"video").file)).arrayBuffer()})));
          const voice=p.audio.enabled?asset(p,p.audio.audioId,"audio"):undefined;
          if(voice)files.push({name:"voice",buffer:await (await this.disk.read(voice.file)).arrayBuffer()});
          if(p.audio.enabled&&p.audio.musicId)files.push({name:"music",buffer:await (await this.disk.read(asset(p,p.audio.musicId,"music").file)).arrayBuffer()});
          const result=await media({action:"compose",files,project:p,narration:voice?.narration});entry=await this.cacheBlob(j.key,result.blob!,result.info.duration);
        }
        entry.jobId=j.id;await this.disk.writeJSON("cache/"+j.key+".json",entry);j.result={file:entry.file,data:entry.data};await this.saveJob(j);await this.attach(j,entry);
      }catch(e){
        // A resumable fal job always retains requestId. A network failure on a non-queue AI call is ambiguous.
        j.status=j.status==="running"&&paid(j.action)&&!j.requestId&&!(e instanceof ProviderError && e.definitive)?"uncertain":"failed";
        j.stage=j.status==="uncertain"?"Yêu cầu AI chưa xác định":"Bước thất bại";j.error=e instanceof Error?e.message:"Không xử lý được bước.";j.providerFailed=e instanceof ProviderError&&e.providerFailed;await this.saveJob(j);
      }
    },true);
  }
  private async tick(projectId?:string){
    const s=await this.settings();const jobs=(await this.jobs(projectId)).filter(active);
    await Promise.all(jobs.map(async j=>{for(let slot=0;slot<s.concurrency;slot++){const acquired=await this.disk.lock("slot-"+slot,async()=>{await this.process(j.id);return true;},true);if(acquired)break;}}));return {ok:true};
  }
  async api<T>(path:string,method="GET",body?:unknown):Promise<T>{return await this.request(path,method,body) as T;}
  private async request(path:string,method:string,body?:unknown):Promise<unknown>{
    if(path==="settings"){
      if(method==="GET")return this.config();
      const old=await this.settings(),input=body as Partial<Settings>;const s={...old};
      for(const key of Object.keys(defaults) as (keyof Settings)[])if(input[key]!==undefined && (!["falKey","openaiKey"].includes(key)||String(input[key]).trim()))Object.assign(s,{[key]:input[key]});
      await this.proxy("test",{settings:s});await this.disk.writeJSON("settings.json",s);return this.config();
    }
    if(path==="settings/test")return this.proxy("test",{settings:await this.settings()});
    if(path==="projects"){
      if(method==="GET"){const projects=(await Promise.all((await this.disk.list("projects")).map(id=>this.project(id)))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));return {projects:projects.map(({id,name,updatedAt})=>({id,name,updatedAt}))};}
      const timestamp=now();const p:Project={id:crypto.randomUUID(),revision:0,createdAt:timestamp,updatedAt:timestamp,name:"",features:"",message:"",primaryId:"",mode:"suggest",suggestions:[],scenes:[],assets:[],ratio:"9:16",resolution:(await this.settings()).resolution,audio:{enabled:false,source:"upload",url:"",audioId:"",musicId:"",text:"",language:"vi",voice:"coral",speed:1,start:0,end:null,volume:1,musicVolume:0.15,subtitles:false,overflow:"trim"}};await this.saveProject(p);return this.response(p);
    }
    if(path==="jobs/tick")return this.tick((body as {projectId?:string}).projectId);
    const parts=path.split("/");
    if(parts[0]==="jobs" && parts[2]==="retry")return this.disk.lock("queue",async()=>{
      const j=await this.disk.json<Job>("jobs/"+parts[1]+".json");if(!j)throw new Error("Không tìm thấy job.");await this.idle(j.projectId);if(!["failed","uncertain"].includes(j.status)||j.providerFailed)throw new Error("Job không thể tiếp tục.");
      const input=body as {requestId?:string;acknowledgeUncertain?:boolean};
      if(j.status==="uncertain" && j.action==="video"){if(!input.requestId||!/^\w[\w-]{0,149}$/.test(input.requestId))throw new Error("Nhập request ID từ fal dashboard.");j.requestId=input.requestId;j.phase="submitted";}
      else if(j.status==="uncertain"&&!input.acknowledgeUncertain)throw new Error("Xác nhận đã kiểm tra provider trước khi gửi lại.");
      j.status=j.requestId?"polling":"queued";j.submittedAt=now();j.error=undefined;await this.saveJob(j);return {job:j};
    });
    if(path==="cache")return this.disk.lock("queue",async()=>{
      if(method==="DELETE"){if((await this.jobs()).some(active))throw new Error("Chờ job kết thúc trước khi xóa cache.");await this.disk.remove("cache",true);return {bytes:0,entries:0};}
      let bytes=0,entries=0;for(const name of await this.disk.list("cache")){const file=await this.disk.read("cache/"+name);bytes+=file.size;if(name.endsWith(".json"))entries++;}return {bytes,entries};
    });
    if(parts[0]!=="projects"||!parts[1])throw new Error("Thao tác không hợp lệ.");const id=parts[1];
    if(parts.length===2){
      if(method==="GET")return this.response(await this.project(id));
      return this.disk.lock("project-"+id,async()=>{await this.idle(id);const old=await this.project(id),input=body as Project;if(old.revision!==input.revision)throw new Error("Project đổi ở tab khác. Reload trước khi lưu.");
        // Never accept overwritten assets/job outputs from an old UI snapshot.
        const p={...input,assets:old.assets,finalId:old.finalId,finalKey:old.finalKey};await this.saveProject(p);return this.response(p);});
    }
    if(parts[2]==="jobs"){const input=body as {action:Action;sceneId?:string;force?:boolean};return {job:await this.enqueue(id,input.action,input.sceneId,input.force)};}
    if(parts[2]==="assets")return this.disk.lock("project-"+id,async()=>{
      await this.idle(id);const p=await this.project(id);
      if(method==="DELETE"){
        const a=asset(p,parts[3]);if(p.scenes.some(s=>[s.sourceId,s.imageId,s.videoId].includes(a.id))||[p.audio.audioId,p.audio.musicId,p.finalId].includes(a.id))throw new Error("File đang được cảnh/audio sử dụng. Bỏ lựa chọn trước khi xóa.");
        p.assets=p.assets.filter(v=>v.id!==a.id);if(p.primaryId===a.id)p.primaryId=p.assets.find(v=>v.kind==="image")?.id||"";await this.saveProject(p);await this.disk.remove(a.file);const url=this.urls.get(a.file);if(url)URL.revokeObjectURL(url);this.urls.delete(a.file);return this.response(p);
      }
      const form=body as FormData,file=form.get("file") as File,kind=form.get("kind") as "image"|"audio"|"music";
      if(!file?.size||file.size>(kind==="image"?20:100)*1024*1024)throw new Error("Ảnh tối đa 20MB, audio tối đa 100MB.");
      let blob:Blob=file,duration:number|undefined;
      if(kind==="image"){if(p.assets.filter(a=>a.kind==="image"&&a.origin!=="generated").length>=12)throw new Error("Tối đa 12 ảnh gốc.");const mime=await checkImage(file);blob=new Blob([file],{type:mime});}
      else {if(!/\.(mp3|wav|m4a)$/i.test(file.name))throw new Error("Chỉ hỗ trợ MP3, WAV, M4A.");const result=await media({action:"extract",files:[{name:"input",buffer:await file.arrayBuffer()}]});blob=result.blob!;duration=result.info.duration;}
      const a=await this.importAsset(p,blob,kind,file.name,duration,"upload");if(kind==="image"&&!p.primaryId)p.primaryId=a.id;if(kind==="audio"){p.audio.audioId=a.id;p.audio.start=0;p.audio.end=null;}if(kind==="music")p.audio.musicId=a.id;await this.saveProject(p);return this.response(p);
    });
    throw new Error("Thao tác không được hỗ trợ.");
  }
}
