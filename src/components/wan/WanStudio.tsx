"use client";
/* eslint-disable @next/next/no-img-element -- product images served by local storage */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Action, AudioOptions, Job, Project, ProjectResponse, PublicSettings, Scene } from "@/features/wan/types";
import { BrowserStudio } from "@/features/wan/browser/studio";
import { folderSupported } from "@/features/wan/browser/disk";
import { capabilities } from "@/features/wan/types";
type Configuration = {settings:PublicSettings; dependencies:{tools:{name:string;available:boolean}[];instructions:string};worker:{running:boolean;mode?:string};storage:{mode:string;configured:boolean;instructions:string;uploadPrefix?:string}};
type Summary = {id:string;name:string;updatedAt:string};
async function serverApi<T>(path:string,method="GET",body?:unknown):Promise<T> {
  const response=await fetch("/api/wan/"+path,{method,cache:"no-store",
    headers:body instanceof FormData ? undefined : body===undefined ? undefined : {"Content-Type":"application/json"},
    body:body===undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body)});
  const result=await response.json().catch(()=>({error:"Server trả lỗi HTTP "+response.status+". Thử lại hoặc kiểm tra cấu hình triển khai."}));if(!response.ok)throw new Error(result.error || "Yêu cầu thất bại.");return result as T;
}
const isActive=(j:Job)=>["queued","running","polling"].includes(j.status);
const serverAssetURL=(p:Project,a:string)=>"/api/wan/projects/"+p.id+"/assets/"+a;
function Field({label,children}:{label:string;children:React.ReactNode}) {return <label><span>{label}</span>{children}</label>;}
function AudioPreview({src,start,end,volume}:{src:string;start:number;end:number|null;volume:number}) {
  const ref=useRef<HTMLAudioElement>(null);
  useEffect(()=>{if(ref.current)ref.current.volume=Math.min(1,volume);},[volume]);
  return <audio ref={ref} src={src} controls preload="metadata"
    onPlay={()=>{const a=ref.current;if(a && (a.currentTime<start || (end!==null && a.currentTime>=end)))a.currentTime=start;}}
    onTimeUpdate={()=>{const a=ref.current;if(a && end!==null && a.currentTime>=end)a.pause();}}/>;
}
export function WanStudio({initialStorage="directory"}:{initialStorage?:"directory"|"server"}) {
  const [local]=useState(()=>new BrowserStudio());
  const [storageMode,setStorageMode]=useState<"directory"|"server">(initialStorage);
  const [folderName,setFolderName]=useState("");
  const directory=storageMode==="directory";
  const api=useCallback(async <T,>(path:string,method="GET",body?:unknown):Promise<T>=>directory?local.api<T>(path,method,body):serverApi<T>(path,method,body),[directory,local]);
  const assetURL=(p:Project,a:string)=>directory?local.assetURL(p,a):serverAssetURL(p,a);

  const [project,setProject]=useState<Project|null>(null);const current=useRef<Project|null>(null);
  const [jobs,setJobs]=useState<Job[]>([]);const [projects,setProjects]=useState<Summary[]>([]);
  const [configuration,setConfiguration]=useState<Configuration|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
  const [saved,setSaved]=useState(true);const dirty=useRef(false);const editVersion=useRef(0);
  const saving=useRef<Promise<void>|null>(null);const [showSettings,setShowSettings]=useState(false);
  const [cache,setCache]=useState<{bytes:number;entries:number}|null>(null);
  const tickRunning=useRef(false);
  const disabled=busy || jobs.some(isActive);
  function assign(p:Project) {current.current=p;setProject(p);}
  const load=useCallback(async(projectId:string)=>{
    const r=await api<ProjectResponse>("projects/"+projectId);
    current.current=r.project;setProject(r.project);setJobs(r.jobs);dirty.current=false;setSaved(true);
    window.history.replaceState(null,"","/product-video/wan?project="+projectId+(directory?"":"&storage=server"));
  },[api,directory]);
  useEffect(()=>{
    let stopped=false;
    (async()=>{if(directory){await local.initialize();if(!stopped)setFolderName(local.disk.selected?.name||"");}return Promise.all([api<Configuration>("settings"),api<{projects:Summary[]}>("projects")]);})().then(async([config,list])=>{
      if(stopped)return;setConfiguration(config);setProjects(list.projects);
      const selected=new URLSearchParams(window.location.search).get("project") || list.projects[0]?.id;
      if(selected && config.storage.configured)await load(selected);
    }).catch(e=>{if(!stopped)setError(e.message);});
    return ()=>{stopped=true;};
  },[load,api,directory,local]);
  const projectId=project?.id;
  const cloud=configuration?.storage.mode==="vercel-blob";
  const hasActiveJob=jobs.some(isActive);
  useEffect(()=>{
    if((!cloud && !directory) || !projectId || !hasActiveJob)return;
    let stopped=false;
    async function tick(){
      if(tickRunning.current)return;tickRunning.current=true;
      try{await api("jobs/tick","POST",{projectId});}
      catch(e){if(!stopped)setError("Không xử lý được bước tiếp theo: "+(e instanceof Error?e.message:"Kiểm tra kết nối."));}
      finally{tickRunning.current=false;}
    }
    void tick();const timer=setInterval(()=>void tick(),5000);
    return ()=>{stopped=true;clearInterval(timer);};
  },[cloud,directory,projectId,hasActiveJob,api]);
  useEffect(()=>{
    if(!projectId)return;
    let stopped=false;
    const timer=setInterval(()=>{
      if(dirty.current || saving.current)return;
      api<ProjectResponse>("projects/"+projectId).then(r=>{
        if(stopped || dirty.current || saving.current)return;
        assign(r.project);setJobs(r.jobs);
      }).catch(e=>{if(!stopped)setError("Không cập nhật được tiến trình: "+e.message);});
      api<Configuration>("settings").then(c=>{if(!stopped)setConfiguration(c);}).catch(()=>{});
    },2500);
    return ()=>{stopped=true;clearInterval(timer);};
  },[projectId,api]);
  function edit(fn:(p:Project)=>Project) {
    if(!current.current)return;
    assign(fn(current.current));dirty.current=true;editVersion.current++;setSaved(false);
  }
  const save=useCallback(async()=>{
    if(saving.current)await saving.current;
    if(!dirty.current || !current.current)return;
    const snapshot=current.current;const version=editVersion.current;
    const task=api<ProjectResponse>("projects/"+snapshot.id,"PATCH",snapshot).then(r=>{
      if(editVersion.current===version){dirty.current=false;current.current=r.project;setProject(r.project);setSaved(true);}
      else {current.current={...current.current!,revision:r.project.revision};setProject(current.current);}
      setJobs(r.jobs);
    });
    saving.current=task;
    try{await task;}finally{if(saving.current===task)saving.current=null;}
  },[api]);
  useEffect(()=>{
    if(!project || !dirty.current || disabled)return;
    const timer=setTimeout(()=>{save().catch(e=>setError("Chưa lưu: "+e.message));},800);
    return ()=>clearTimeout(timer);
  },[project,disabled,save]);
  async function execute(fn:()=>Promise<void>) {
    setBusy(true);setError("");setNotice("");
    try {await save();await fn();}
    catch(e){setError(e instanceof Error?e.message:"Yêu cầu thất bại.");}
    finally{setBusy(false);}
  }
  async function selectFolder(reconnect:boolean) {
    setBusy(true);setError("");
    try {
      // Do not await save/network before the native picker: it requires click activation.
      if(!folderSupported())throw new Error("Chọn thư mục cần Chrome/Edge trên máy tính. Mở URL này trong Chrome hoặc Edge.");
      await local.select(reconnect);setFolderName(local.disk.selected?.name||"");
      setProject(null);current.current=null;setJobs([]);dirty.current=false;setSaved(true);
      setConfiguration(await api("settings"));const list=await api<{projects:Summary[]}>("projects");setProjects(list.projects);
      if(list.projects[0])await load(list.projects[0].id);else window.history.replaceState(null,"","/product-video/wan");
      setNotice("Đã kết nối thư mục. Dữ liệu sẽ được ghi tại đây.");
    } catch(e){
      if(e instanceof DOMException && e.name==="AbortError")return;
      if(e instanceof DOMException && ["SecurityError","NotAllowedError"].includes(e.name))setError("Trình duyệt/khung nhúng này không cho chọn thư mục. Mở URL trực tiếp bằng Chrome hoặc Edge trên máy tính, rồi bấm Chọn thư mục lưu và cấp quyền đọc/ghi.");
      else setError(e instanceof Error?e.message:"Không mở được thư mục.");
    }
    finally{setBusy(false);}
  }
  async function reload() {if(current.current)await load(current.current.id);}
  async function job(action:Action,sceneId?:string,force=false) {
    await execute(async()=>{
      const r=await api<{job:Job}>("projects/"+current.current!.id+"/jobs","POST",{action,sceneId,force});
      setJobs(j=>[...j.filter(v=>v.id!==r.job.id),r.job]);
    });
  }
  async function upload(files:FileList|null,kind:"image"|"audio"|"music") {
    if(!files?.length)return;
    await execute(async()=>{
      for(const file of Array.from(files)){
        const projectId=current.current!.id;
        let r:ProjectResponse;
        if(cloud){
          if(file.size>(kind==="image"?20:100)*1024*1024)throw new Error("Ảnh tối đa 20MB, audio tối đa 100MB.");
          const {upload}=await import("@vercel/blob/client");
          const blob=await upload(configuration!.storage.uploadPrefix+projectId+"/"+crypto.randomUUID(),file,{
            access:"private",handleUploadUrl:"/api/wan/uploads/token",multipart:true,
            clientPayload:JSON.stringify({projectId,kind}),
          });
          r=await api<ProjectResponse>("projects/"+projectId+"/assets","POST",{kind,name:file.name,pathname:blob.pathname});
        }else{
          const form=new FormData();form.set("file",file);form.set("kind",kind);
          r=await api<ProjectResponse>("projects/"+projectId+"/assets","POST",form);
        }
        assign(r.project);setJobs(r.jobs);
      }
      setSaved(true);
    });
  }
  function editScene(sceneId:string,patch:Partial<Scene>) {edit(p=>({...p,scenes:p.scenes.map(s=>s.id===sceneId?{...s,...patch}:s)}));}
  function editAudio(patch:Partial<AudioOptions>) {edit(p=>({...p,audio:{...p.audio,...patch}}));}
  function addScene(prompt="",motion="",name="Cảnh mới") {
    edit(p=>({...p,scenes:[...p.scenes,{id:crypto.randomUUID(),name,prompt,motion,original:false,sourceId:p.primaryId}]}));
  }
  const images=project?.assets.filter(a=>a.kind==="image") || [];
  const originalImages=images.filter(a=>a.origin!=="generated");
  const audio=project?.assets.find(a=>a.id===project.audio.audioId);
  const final=project?.assets.find(a=>a.id===project.finalId);
  const duration=project?.scenes.reduce((sum,s)=>sum+(project.assets.find(a=>a.id===s.videoId)?.duration||0),0) || 0;
  const audioLength=Math.max(0,(project?.audio.end ?? audio?.duration ?? 0)-(project?.audio.start || 0));
  const toolsReady=configuration?.dependencies.tools.every(t=>t.available);
  return <>
    <header className="topbar"><Link className="brand" href="/"><span className="brand-mark">C</span><span>ClipMint <b>AI</b></span></Link>
      <nav><Link href="/">Studio hiện tại</Link><Link href="/meta-ai">Meta AI</Link><Link href="/product-video/wan" aria-current="page">Video Wan</Link><button className="button secondary" onClick={()=>setShowSettings(v=>!v)}>Cấu hình AI</button></nav></header>
    <main className="wan-studio">
      <div className="wan-heading"><div><span className="eyebrow">PRODUCT VIDEO · WAN</span><h1>Từ ảnh sản phẩm đến video.</h1><p>Chọn bối cảnh, duyệt ảnh rồi tạo chuyển động. Audio được ghép riêng.</p></div>
        <div className="wan-projects"><select aria-label="Chọn project" disabled={disabled} value={project?.id || ""} onChange={e=>execute(()=>load(e.target.value))}>
          <option value="" disabled>Chọn project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name || "Project "+p.id.slice(0,8)}</option>)}
          {project && !projects.some(p=>p.id===project.id) && <option value={project.id}>{project.name || "Project mới"}</option>}
        </select><button className="button secondary" disabled={disabled || !configuration?.storage.configured} onClick={()=>execute(async()=>{
          const r=await api<ProjectResponse>("projects","POST");assign(r.project);setJobs(r.jobs);
          setProjects(list=>[{id:r.project.id,name:"",updatedAt:r.project.updatedAt},...list]);dirty.current=false;setSaved(true);
          window.history.replaceState(null,"","/product-video/wan?project="+r.project.id+(directory?"":"&storage=server"));
        })}>+ Project mới</button></div></div>
      {error && <div className="error-banner" role="alert"><p>{error}</p><button aria-label="Đóng lỗi" onClick={()=>setError("")}>×</button></div>}
      {notice && <p className="ai-disclosure" role="status">{notice}</p>}
      <section className="panel"><div className="section-head"><div><h2>Lưu trên máy của bạn</h2><p>Project, ảnh, audio, video, cache và job lưu vào thư mục bạn chọn. Không cần Vercel Blob.</p></div></div>
        <div className="wan-actions"><button className={"button "+(directory?"primary":"secondary")} disabled={disabled || !saved} onClick={()=>{window.history.replaceState(null,"","/product-video/wan");setStorageMode("directory");setProject(null);current.current=null;setJobs([]);setProjects([]);setConfiguration(null);}}>Thư mục máy người dùng</button>
          <button className={"button "+(!directory?"primary":"secondary")} disabled={disabled || !saved} onClick={()=>{window.history.replaceState(null,"","/product-video/wan?storage=server");setStorageMode("server");setProject(null);current.current=null;setJobs([]);setProjects([]);setConfiguration(null);}}>Lưu trên server (tùy chọn)</button>
          {directory && <button className="button primary" disabled={disabled || !saved} onClick={()=>void selectFolder(false)}>{folderName?"Đổi thư mục":"Chọn thư mục lưu"}</button>}
          {directory && folderName && !configuration?.storage.configured && <button className="button secondary" disabled={busy} onClick={()=>void selectFolder(true)}>Cấp lại quyền thư mục</button>}</div>
        {directory && <p className="ai-disclosure">{folderName?"Thư mục: "+folderName+" / clipmint-browser":"Chưa chọn thư mục."} · Chrome/Edge trên máy tính. Giữ tab mở khi xử lý; đóng tab rồi mở lại sẽ khôi phục project và theo dõi job Wan đã lưu.</p>}
      </section>
      {configuration && !configuration.storage.configured && <p className="warning">{configuration.storage.instructions}</p>}
      {configuration && !configuration.worker.running && <p className="warning">Worker chưa chạy. Chạy <code>npm run dev:wan</code> hoặc <code>npm run wan:worker</code> khi web đã chạy. Job đã lưu sẽ tiếp tục khi worker khởi động.</p>}
      {showSettings && configuration && <SettingsPanel configuration={configuration} disabled={busy || !configuration.storage.configured}
        onSave={input=>execute(async()=>{await api("settings","PUT",input);setConfiguration(await api("settings"));setNotice("Đã lưu cấu hình.");})}
        onTest={()=>execute(async()=>{const r=await api<{message:string}>("settings/test","POST",{});setNotice(r.message);setConfiguration(await api("settings"));})}/>}
      {!project && <section className="panel"><h2>Tạo project để bắt đầu</h2><p>Bấm “Project mới” ở trên. Ảnh, prompt, lựa chọn và video được lưu {cloud?"bền vững trong Vercel Blob Private":"trên máy"}.</p></section>}
      {project && <div className="wan-layout"><div className="main-column">
        <section className="panel"><div className="section-head"><span className="step">1</span><div><h2>Ảnh sản phẩm</h2><p>JPEG, PNG, WebP · 20MB/ảnh. Ảnh chính cho cảnh mở đầu.</p></div><span className="status-chip">{saved?"Đã lưu":"Đang lưu…"}</span></div>
          <fieldset disabled={disabled}><label className="wan-upload">+ Upload nhiều ảnh<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>{upload(e.target.files,"image");e.target.value="";}}/></label>
            <div className="asset-grid">{originalImages.map(a=><article className="asset-card" key={a.id}><img src={assetURL(project,a.id)} alt={a.name}/>
              <div><strong>{a.name}</strong><small>{(a.size/1024/1024).toFixed(1)} MB</small></div><div className="asset-actions">
                <button className={"button "+(a.id===project.primaryId?"primary":"secondary")} onClick={()=>edit(p=>({...p,primaryId:a.id,scenes:p.scenes.map((s,i)=>i===0?{...s,sourceId:a.id}:s)}))}>{a.id===project.primaryId?"✓ Ảnh chính":"Chọn ảnh chính"}</button>
                <button className="button danger" onClick={()=>execute(async()=>{await api("projects/"+project.id+"/assets/"+a.id,"DELETE");await reload();})}>Xóa</button>
              </div></article>)}</div>
            <div className="form-grid wan-fields"><Field label="Tên sản phẩm (tùy chọn)"><input value={project.name} onChange={e=>edit(p=>({...p,name:e.target.value}))}/></Field>
              <Field label="Thông điệp quảng cáo (tùy chọn)"><input value={project.message} onChange={e=>edit(p=>({...p,message:e.target.value}))}/></Field>
              <label className="wide"><span>Đặc điểm đã biết (tùy chọn)</span><textarea rows={3} value={project.features} onChange={e=>edit(p=>({...p,features:e.target.value}))} placeholder="AI không tự bịa giá, chất liệu hoặc công dụng."/></label></div>
          </fieldset>
        </section>
        <section className="panel"><div className="section-head"><span className="step">2</span><div><h2>Bối cảnh & chuyển động</h2><p>Tạo ảnh, kiểm tra sản phẩm rồi chọn ảnh cho Wan.</p></div></div>
          <fieldset disabled={disabled || !project.primaryId}><div className="wan-tabs">
            <button className={"button "+(project.mode==="suggest"?"primary":"secondary")} onClick={()=>edit(p=>({...p,mode:"suggest"}))}>AI gợi ý bối cảnh</button>
            <button className={"button "+(project.mode==="manual"?"primary":"secondary")} onClick={()=>edit(p=>({...p,mode:"manual"}))}>Tự nhập prompt</button></div>
            {project.mode==="suggest" && <>
              <p className="ai-disclosure">{configuration?.settings.openaiConfigured?"Đề xuất 3–5 bối cảnh từ ảnh và thông tin bạn nhập.":"Chưa cấu hình OpenAI. Mở Cấu hình AI."}</p>
              <div className="wan-actions"><button className="button primary" disabled={!configuration?.settings.openaiConfigured} onClick={()=>job("suggest")}>Gợi ý bối cảnh</button>
                {!!project.suggestions.length && <button className="button secondary" onClick={()=>job("suggest",undefined,true)}>Gợi ý lại · bỏ cache</button>}</div>
              <div className="hook-grid">{project.suggestions.map((s,i)=><button key={i} className="hook-card" disabled={project.scenes.length>=8} onClick={()=>addScene(s.description,s.motion,s.name)}><strong>{s.name}</strong><span>{s.description}</span><small>{s.motion}</small><span>+ Chọn làm cảnh</span></button>)}</div></>}
            {project.mode==="manual" && <button className="button secondary" disabled={project.scenes.length>=8} onClick={()=>addScene()}>+ Thêm cảnh từ prompt</button>}
            <div className="wan-scenes">{project.scenes.map((scene,index)=>{
              const image=project.assets.find(a=>a.id===(scene.original?scene.sourceId:scene.imageId));
              const video=project.assets.find(a=>a.id===scene.videoId);
              return <article className="wan-scene" key={scene.id}><div className="wan-scene-head"><strong>Cảnh {index+1}</strong><button className="button danger" onClick={()=>edit(p=>({...p,scenes:p.scenes.filter(s=>s.id!==scene.id)}))}>Bỏ cảnh</button></div>
                <div className="form-grid"><Field label="Tên cảnh"><input value={scene.name} onChange={e=>editScene(scene.id,{name:e.target.value})}/></Field>
                  <Field label={index===0?"Ảnh nguồn cảnh mở đầu":"Ảnh nguồn"}><select value={scene.sourceId} onChange={e=>editScene(scene.id,{sourceId:e.target.value})}>{images.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                  <Field label="Bối cảnh"><textarea rows={3} value={scene.prompt} onChange={e=>editScene(scene.id,{prompt:e.target.value})}/></Field>
                  <Field label="Chuyển động sản phẩm/camera"><textarea rows={3} value={scene.motion} onChange={e=>editScene(scene.id,{motion:e.target.value})} placeholder="Camera tiến chậm, sản phẩm xoay nhẹ…"/></Field></div>
                <label className="wan-check"><input type="checkbox" checked={scene.original} onChange={e=>editScene(scene.id,{original:e.target.checked})}/>Dùng trực tiếp ảnh nguồn, bỏ qua tạo bối cảnh</label>
                <div className="wan-actions"><button className="button secondary" disabled={!configuration?.settings.openaiConfigured} onClick={()=>job("improve",scene.id)}>AI cải thiện prompt</button>
                  {!scene.original && <><button className="button primary" disabled={!configuration?.settings.openaiConfigured} onClick={()=>job("image",scene.id)}>Tạo ảnh bối cảnh</button>
                    {scene.imageId && <button className="button secondary" onClick={()=>job("image",scene.id,true)}>Tạo lại ảnh · bỏ cache</button>}</>}</div>
                {image && <div className="wan-scene-preview"><img src={assetURL(project,image.id)} alt={"Ảnh input cảnh "+(index+1)}/><div><strong>Preview được chọn làm input Wan</strong><p>Kiểm tra hình dáng, màu, logo và chi tiết. AI có thể làm thay đổi sản phẩm.</p><p>Sửa prompt và tạo lại ảnh nếu cần.</p></div></div>}
                {images.some(a=>a.origin==="generated") && <Field label="Chọn ảnh bối cảnh đã lưu khác (dùng trực tiếp)"><select value="" onChange={e=>{if(e.target.value)editScene(scene.id,{sourceId:e.target.value,original:true});}}><option value="">Chọn preview…</option>
                  {images.filter(a=>a.origin==="generated").map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
                <div className="wan-actions"><button className="button primary" disabled={!image || !configuration?.settings.falConfigured || !toolsReady} onClick={()=>job("video",scene.id)}>Duyệt ảnh & tạo video Wan</button>
                  {(video || jobs.some(j=>j.sceneId===scene.id && j.providerFailed)) && <button className="button secondary" onClick={()=>job("video",scene.id,true)}>Tạo lại video · bỏ cache</button>}</div>
                {video && <video className="wan-video" src={assetURL(project,video.id)} controls preload="metadata"/>}
              </article>;
            })}</div>
            {!!project.scenes.length && <button className="button secondary" disabled={project.scenes.length>=8} onClick={()=>addScene()}>+ Thêm cảnh</button>}
          </fieldset>
        </section>
        <section className="panel"><div className="section-head"><span className="step">3</span><div><h2>Audio</h2><p>Đổi audio chỉ ghép MP4, không tạo lại video Wan.</p></div></div>
          <fieldset disabled={disabled}><label className="wan-check"><input type="checkbox" checked={project.audio.enabled} onChange={e=>editAudio({enabled:e.target.checked})}/>Thêm audio</label>
            {!project.audio.enabled && <p className="ai-disclosure">MP4 xuất ra không có track audio, kể cả audio gốc provider.</p>}
            {project.audio.enabled && <>
              <div className="wan-tabs">{([["url","Lấy audio từ video"],["upload","Upload audio"],["tts","AI tạo audio"]] as const).map(([value,label])=><button key={value} className={"button "+(project.audio.source===value?"primary":"secondary")} onClick={()=>editAudio({source:value})}>{label}</button>)}</div>
              {project.audio.source==="url" && <><Field label="URL video công khai"><input type="url" value={project.audio.url} onChange={e=>editAudio({url:e.target.value})} placeholder="https://…/video.mp4"/></Field><p className="ai-disclosure">Hỗ trợ link download trực tiếp. Link TikTok/YouTube cần đăng nhập hoặc bị chặn: tải file rồi upload MP3/WAV/M4A.</p><button className="button secondary" onClick={()=>job("extract")}>Download & trích audio</button></>}
              {project.audio.source==="upload" && <label className="wan-upload">MP3, WAV, M4A · 100MB<input type="file" accept=".mp3,.wav,.m4a" onChange={e=>{upload(e.target.files,"audio");e.target.value="";}}/></label>}
              {project.audio.source==="tts" && <><Field label="Lời thoại — sửa và duyệt trước khi tạo"><textarea rows={5} maxLength={4000} value={project.audio.text} onChange={e=>editAudio({text:e.target.value})}/></Field>
                <div className="wan-actions"><button className="button secondary" disabled={!configuration?.settings.openaiConfigured} onClick={()=>job("copy")}>AI viết lời quảng cáo</button></div>
                <div className="config-grid"><Field label="Ngôn ngữ"><select value={project.audio.language} onChange={e=>editAudio({language:e.target.value})}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></Field>
                  <Field label="Giọng"><select value={project.audio.voice} onChange={e=>editAudio({voice:e.target.value})}>{capabilities.voices.map(v=><option key={v}>{v}</option>)}</select></Field>
                  <Field label="Tốc độ (0.25–4)"><input type="number" min={0.25} max={4} step={0.05} value={project.audio.speed} onChange={e=>editAudio({speed:Number(e.target.value)})}/></Field></div>
                <div className="wan-actions"><button className="button primary" disabled={!configuration?.settings.openaiConfigured || !project.audio.text.trim()} onClick={()=>job("tts")}>Duyệt lời & tạo giọng AI</button>
                  {audio?.narration && <button className="button secondary" onClick={()=>job("tts",undefined,true)}>Tạo lại giọng · bỏ cache</button>}</div><p className="ai-disclosure">Giọng đọc do AI tạo; chất lượng tiếng Việt tùy provider/giọng.</p></>}
              <Field label="Audio đã lưu"><select value={project.audio.audioId} onChange={e=>editAudio({audioId:e.target.value,start:0,end:null})}><option value="">Chưa chọn audio</option>
                {project.assets.filter(a=>a.kind==="audio").map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              {audio && <><p>{audio.duration?.toFixed(1)} giây · {audio.narration?"Có lời thoại đã duyệt":"Audio từ file/video"}</p>
                {audio.narration && <details><summary>Lời của audio đang chọn</summary><p>{audio.narration}</p></details>}
                <AudioPreview src={assetURL(project,audio.id)} start={project.audio.start} end={project.audio.end} volume={project.audio.volume}/></>}
              <div className="config-grid wan-fields"><Field label="Bắt đầu (giây)"><input type="number" min={0} step={0.1} value={project.audio.start} onChange={e=>editAudio({start:Number(e.target.value)})}/></Field>
                <Field label="Kết thúc (trống = hết file)"><input type="number" min={0} step={0.1} value={project.audio.end??""} onChange={e=>editAudio({end:e.target.value===""?null:Number(e.target.value)})}/></Field>
                <Field label={"Âm lượng giọng: "+Math.round(project.audio.volume*100)+"%"}><input type="range" min={0} max={3} step={0.05} value={project.audio.volume} onChange={e=>editAudio({volume:Number(e.target.value)})}/></Field></div>
              <label className="wan-upload">Nhạc nền local<input type="file" accept=".mp3,.wav,.m4a" onChange={e=>{upload(e.target.files,"music");e.target.value="";}}/></label>
              <div className="config-grid"><Field label="Nhạc nền đã lưu"><select value={project.audio.musicId} onChange={e=>editAudio({musicId:e.target.value})}><option value="">Không dùng nhạc nền</option>{project.assets.filter(a=>a.kind==="music").map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></Field>
                <Field label={"Âm lượng nhạc: "+Math.round(project.audio.musicVolume*100)+"%"}><input type="range" min={0} max={1} step={0.01} value={project.audio.musicVolume} onChange={e=>editAudio({musicVolume:Number(e.target.value)})}/></Field></div>
              {project.audio.musicId && <AudioPreview src={assetURL(project,project.audio.musicId)} start={0} end={null} volume={project.audio.musicVolume}/>}
              <label className="wan-check"><input type="checkbox" disabled={!audio?.narration} checked={project.audio.subtitles} onChange={e=>editAudio({subtitles:e.target.checked})}/>Phụ đề từ lời đã duyệt (căn thời gian ước lượng)</label>
              <Field label="Audio dài hơn video"><select value={project.audio.overflow} onChange={e=>editAudio({overflow:e.target.value as AudioOptions["overflow"]})}><option value="trim">Cắt audio theo video</option><option value="extend">Tôi sẽ thêm cảnh trước khi xuất</option></select></Field>
              {audioLength>duration && duration>0 && <p className="warning">Audio {audioLength.toFixed(1)}s, video {duration.toFixed(1)}s. {project.audio.overflow==="trim"?"Sẽ cắt audio khi ghép.":"Thêm cảnh và chủ động tạo video mới; không tự gọi API trả phí."}</p>}
            </>}
          </fieldset>
        </section>
        <section className="panel"><div className="section-head"><span className="step">4</span><div><h2>Xuất MP4</h2><p>Cảnh + audio + phụ đề · {duration.toFixed(1)} giây nguồn.</p></div></div>
          <fieldset disabled={disabled}><div className="config-grid"><Field label="Tỷ lệ"><select value={project.ratio} onChange={e=>edit(p=>({...p,ratio:e.target.value}))}>{capabilities.ratios.map(v=><option key={v}>{v}</option>)}</select></Field>
            <Field label="Resolution"><select value={project.resolution} onChange={e=>edit(p=>({...p,resolution:e.target.value}))}>{capabilities.resolutions.map(v=><option key={v}>{v}</option>)}</select></Field></div>
            <p className="ai-disclosure">Thời lượng mỗi cảnh do endpoint quyết định; schema Wan Turbo không có field duration. Thay tỷ lệ/resolution sẽ cần chủ động tạo lại cảnh phù hợp.</p>
            <div className="wan-actions"><button className="button primary" disabled={!duration || !toolsReady} onClick={()=>job("compose")}>Ghép & xuất MP4</button>
              {final && <button className="button secondary" onClick={()=>job("compose",undefined,true)}>Ghép lại · bỏ cache</button>}</div></fieldset>
          {final && <div className="wan-final"><video className="wan-video" src={assetURL(project,final.id)} controls preload="metadata"/><a className="button primary" href={assetURL(project,final.id)+(directory?"":"?download=1")} download={"clipmint-"+project.id+".mp4"}>↓ Tải MP4</a><p>Bản xuất đã lưu. Sau khi đổi lựa chọn, bấm ghép để cập nhật.</p></div>}
        </section>
      </div><aside>
        <div className="privacy-card"><h3>{cloud?"Project trên Vercel":"Project trên máy của bạn"}</h3><p>Input và output lưu {cloud?"trong Blob Private":"local"}. Chỉ ảnh/prompt cần thiết gửi tới provider khi bạn bấm tạo. {directory?"Key bạn nhập lưu trong settings.json của thư mục; hoặc dùng key môi trường trên Vercel. API proxy chỉ chuyển yêu cầu tới provider.":"Key giữ ở backend."}</p>{(cloud || directory) && <p>Không cần worker local. Giữ trang mở để tải và ghép kết quả; mở lại sẽ tiếp tục với job đã lưu.</p>}<button className="button secondary" disabled={disabled || saved} onClick={()=>execute(save)}>Lưu ngay</button></div>
        <div className="tips-card"><h3>Tiến trình</h3>{jobs.length===0?<p>Chưa có job.</p>:jobs.slice().reverse().map(j=><JobCard key={j.id} job={j} disabled={disabled} onRetry={(requestId,acknowledgeUncertain)=>execute(async()=>{await api("jobs/"+j.id+"/retry","POST",{requestId,acknowledgeUncertain});await reload();})}/>)}</div>
        <div className="tips-card"><h3>Cache</h3><p>{cache?cache.entries+" mục · "+(cache.bytes/1024/1024).toFixed(1)+" MB":"Input giống nhau dùng lại kết quả thành công."}</p><div className="wan-actions">
          <button className="button secondary" onClick={()=>execute(async()=>setCache(await api("cache")))}>Xem dung lượng</button><button className="button danger" disabled={disabled} onClick={()=>execute(async()=>{setCache(await api("cache","DELETE"));setNotice("Đã xóa cache; project/ảnh/video/audio đã lưu được giữ lại.");})}>Xóa cache</button></div></div>
      </aside></div>}
    </main>
  </>;
}
function JobCard({job,disabled,onRetry}:{job:Job;disabled:boolean;onRetry:(requestId?:string,acknowledgeUncertain?:boolean)=>void}) {
  const [requestId,setRequestId]=useState("");const [ack,setAck]=useState(false);
  return <article className="wan-job"><strong>{job.stage}{isActive(job)?" …":""}</strong><small>{job.action} · {job.status}{job.cached?" · cache":""}</small>
    {job.requestId && <small>fal ID: {job.requestId}</small>}{job.error && <p className="form-error">{job.error}</p>}
    {["failed","uncertain"].includes(job.status) && !job.providerFailed && <>
      {job.status==="uncertain" && job.action==="video" && <input aria-label="fal request ID từ dashboard" placeholder="Request ID từ fal dashboard" value={requestId} onChange={e=>setRequestId(e.target.value)}/>}
      {job.status==="uncertain" && job.action!=="video" && <label className="wan-check"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>Tôi đã kiểm tra provider, muốn gửi lại (có thể tính phí)</label>}
      <button className="button secondary" disabled={disabled || (job.status==="uncertain" && (job.action==="video"?!requestId:!ack))} onClick={()=>onRetry(requestId||undefined,ack)}>{job.requestId || job.status==="uncertain" && job.action==="video"?"Tiếp tục polling cùng job":"Chạy lại bước này"}</button></>}
  </article>;
}
function SettingsPanel({configuration,disabled,onSave,onTest}:{configuration:Configuration;disabled:boolean;onSave:(input:Partial<PublicSettings>&{falKey:string;openaiKey:string})=>Promise<void>;onTest:()=>void}) {
  const [v,setV]=useState(configuration.settings);const [falKey,setFalKey]=useState("");const [openaiKey,setOpenaiKey]=useState("");const [show,setShow]=useState(false);
  function update(patch:Partial<PublicSettings>) {setV(v=>({...v,...patch}));}
  return <section className="panel"><div className="section-head"><span className="step">⚙</span><div><h2>Cấu hình AI</h2><p>fal.ai cho Wan; OpenAI cho vision, chỉnh ảnh và giọng đọc.</p></div></div>
    <fieldset disabled={disabled}><div className="config-grid"><Field label="Provider"><select value={v.provider} disabled><option>fal.ai</option></select></Field>
      <Field label={"fal key · "+(configuration.settings.falConfigured?"Đã lưu "+configuration.settings.falKeyMasked:"Chưa cấu hình")}><input autoComplete="off" type={show?"text":"password"} value={falKey} placeholder="Trống để giữ key đã lưu" onChange={e=>setFalKey(e.target.value)}/></Field>
      <label className="wide"><span>Model endpoint (adapter đã xác minh schema)</span><input value={v.endpoint} onChange={e=>update({endpoint:e.target.value})}/></label>
      <Field label={"OpenAI key · "+(configuration.settings.openaiConfigured?"Đã lưu "+configuration.settings.openaiKeyMasked:"Chưa cấu hình")}><input autoComplete="off" type={show?"text":"password"} value={openaiKey} placeholder="Trống để giữ key đã lưu" onChange={e=>setOpenaiKey(e.target.value)}/></Field>
      <Field label="Vision/text model"><input value={v.textModel} onChange={e=>update({textModel:e.target.value})}/></Field>
      <Field label="Image-editing model"><select value={v.imageModel} onChange={e=>update({imageModel:e.target.value})}>{capabilities.imageModels.map(v=><option key={v}>{v}</option>)}</select></Field>
      <Field label="TTS model"><input value={v.ttsModel} readOnly/></Field>
      <Field label="Resolution mặc định"><select value={v.resolution} onChange={e=>update({resolution:e.target.value})}>{capabilities.resolutions.map(v=><option key={v}>{v}</option>)}</select></Field>
      <Field label="Timeout polling (giây)"><input type="number" min={30} max={7200} value={v.timeoutSeconds} onChange={e=>update({timeoutSeconds:Number(e.target.value)})}/></Field>
      <Field label="Polling interval (giây)"><input type="number" min={2} max={60} value={v.pollSeconds} onChange={e=>update({pollSeconds:Number(e.target.value)})}/></Field>
      <Field label="Job đồng thời (1–4)"><input type="number" min={1} max={4} value={v.concurrency} onChange={e=>update({concurrency:Number(e.target.value)})}/></Field>
      <Field label="Acceleration"><select value={v.acceleration} onChange={e=>update({acceleration:e.target.value})}>{["none","regular"].map(v=><option key={v}>{v}</option>)}</select></Field>
      <Field label="Video quality"><select value={v.videoQuality} onChange={e=>update({videoQuality:e.target.value})}>{["low","medium","high","maximum"].map(v=><option key={v}>{v}</option>)}</select></Field>
      <Field label="Video write mode"><select value={v.videoWriteMode} onChange={e=>update({videoWriteMode:e.target.value})}>{["fast","balanced","small"].map(v=><option key={v}>{v}</option>)}</select></Field>
      <Field label="Seed (trống = ngẫu nhiên)"><input type="number" min={0} max={2147483647} value={v.seed??""} onChange={e=>update({seed:e.target.value===""?null:Number(e.target.value)})}/></Field></div>
      <label className="wan-check"><input type="checkbox" checked={v.promptExpansion} onChange={e=>update({promptExpansion:e.target.checked})}/>Bật prompt expansion</label>
      <label className="wan-check"><input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}/>Hiện key đang nhập</label>
      <div className="wan-actions"><button className="button primary" onClick={async()=>{await onSave({...v,falKey,openaiKey});setFalKey("");setOpenaiKey("");}}>Lưu cấu hình</button><button className="button secondary" onClick={onTest}>Kiểm tra đã lưu · không inference</button></div></fieldset>
    {configuration.storage.mode==="browser-directory" && <p className="ai-disclosure">Key nhập ở đây được lưu plaintext trong settings.json trên máy bạn, gửi qua HTTPS tới proxy khi gọi AI. Không chia sẻ file này. Có thể dùng FAL_KEY và OPENAI_API_KEY trong Vercel thay thế.</p>}
    <p className="ai-disclosure">Kiểm tra schema/cấu hình/storage/dependency; không tạo video/ảnh/giọng và không xác nhận key/quota. Endpoint khác cần bổ sung adapter.</p>
    <p>{configuration.dependencies.tools.map(t=>t.name+": "+(t.available?"✓ sẵn sàng":"thiếu")).join(" · ")}</p>
    {!configuration.dependencies.tools.every(t=>t.available) && <p className="warning">{configuration.dependencies.instructions}</p>}
  </section>;
}
