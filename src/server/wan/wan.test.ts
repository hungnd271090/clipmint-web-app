import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { atomicJSON, assetById, createProject, exists, hash, importAsset, localPath, readJSON, readProject, saveProject } from "./storage";
import { getSettings, publicSettings, putSettings } from "./settings";
import { allJobs, enqueue, imageKey, jobPath, processJob, retryJob, startWorker, videoKey } from "./jobs";
import { compose, extractAudio, probe, run, validateImage } from "./media";
import { clearCache, getCache } from "./cache";
import { handle } from "./api";
import { updateProject } from "./projects";
import type { Job, Project } from "../../features/wan/types";
import { downloadURL } from "./network";
vi.mock("./network",()=>({downloadURL:vi.fn()}));
let fixture:string;let root:string;let png:Buffer;let video:Buffer;
beforeAll(async()=>{
  fixture=await mkdtemp(path.join(os.tmpdir(),"clipmint-fixture-"));
  png=await sharp({create:{width:128,height:128,channels:3,background:"#16c79a"}}).png().toBuffer();
  await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=c=green:s=90x160:d=0.75","-c:v","libx264","-pix_fmt","yuv420p",path.join(fixture,"scene.mp4")]);
  await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","sine=frequency=440:duration=2","-c:a","pcm_s16le",path.join(fixture,"voice.wav")]);
  video=await readFile(path.join(fixture,"scene.mp4"));
},30000);
beforeEach(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),"clipmint-test-"));vi.stubEnv("CLIPMINT_DATA_DIR",root);
  await putSettings({falKey:"test-fal-key",openaiKey:"test-openai-key",resolution:"480p"});
  vi.mocked(downloadURL).mockResolvedValue(video);
});
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});});
afterAll(()=>rm(fixture,{recursive:true,force:true}));
async function product():Promise<Project> {
  const p=await createProject();const input=path.join(root,"product.png");await writeFile(input,png);
  const image=await importAsset(p,input,"image","image/png","product.png");image.origin="upload";p.primaryId=image.id;
  p.resolution="480p";p.scenes=[{id:"scene1",name:"Scene",prompt:"white studio",motion:"camera moves slowly",original:true,sourceId:image.id}];
  await saveProject(p);return p;
}
async function attachVideo(p:Project) {
  const a=await importAsset(p,path.join(fixture,"scene.mp4"),"video","video/mp4","scene",0.76);
  p.scenes[0].videoId=a.id;p.scenes[0].videoKey=videoKey(await getSettings(),p,p.scenes[0]);await saveProject(p);return a;
}
describe("durable Wan projects/settings/cache",()=>{
  it("persists settings, masks secrets and checks configuration without provider calls",async()=>{
    const s=await getSettings();expect(s.falKey).toBe("test-fal-key");
    expect(JSON.stringify(publicSettings(s))).not.toContain("test-fal-key");
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    const r=await handle(new Request("http://localhost:3000/api/wan/settings/test",{method:"POST"}),["settings","test"]);
    expect(r.status).toBe(200);expect(fetcher).not.toHaveBeenCalled();
    expect((await r.json()).message).toContain("Không tạo");
  });
  it("rejects unsupported endpoint/params and non-image/corrupted uploads",async()=>{
    await expect(putSettings({endpoint:"fal-ai/other-model"})).rejects.toThrow("schema");
    await expect(putSettings({pollSeconds:0})).rejects.toThrow();
    await expect(validateImage(Buffer.from("fake image"))).rejects.toThrow("decode");
    const tiff=await sharp(png).tiff().toBuffer();await expect(validateImage(tiff)).rejects.toThrow();
    expect(await validateImage(png)).toBe("image/png");
  });
  it("saves optional fields before upload and blocks stale revisions",async()=>{
    const p=await createProject();const next=await updateProject(p.id,{revision:p.revision,primaryId:"",name:"new product"});
    expect((await readProject(p.id)).name).toBe("new product");
    await expect(updateProject(p.id,{revision:p.revision,name:"old tab"})).rejects.toThrow("đã thay đổi");
    expect(next.revision).toBe(p.revision+1);
  });
  it("keeps generated images out of future product reference keys",async()=>{
    const p=await product();const s=await getSettings();const key=imageKey(s,p,p.scenes[0]);
    const a=await importAsset(p,path.join(root,"product.png"),"image","image/png","generated");a.origin="generated";
    expect(imageKey(s,p,p.scenes[0])).toBe(key);
    expect(videoKey({...s,falKey:"another-key"},p,p.scenes[0])).toBe(videoKey(s,p,p.scenes[0]));
    expect(videoKey({...s,seed:22},p,p.scenes[0])).not.toBe(videoKey(s,p,p.scenes[0]));
    expect(hash({prompt:"  hello \n world  ",a:2})).toBe(hash({a:2,prompt:"hello world"}));
  });
  it("uploads, serves ranges and rejects CSRF/private deployment",async()=>{
    const p=await createProject();const form=new FormData();
    form.set("kind","image");form.set("file",new File([new Uint8Array(png)],"safe.png",{type:"image/png"}));
    const r=await handle(new Request("http://localhost:3000/api/wan/projects/"+p.id+"/assets",{method:"POST",body:form}),["projects",p.id,"assets"]);
    expect(r.status).toBe(201);const uploaded=(await r.json()).project as Project;
    const file=uploaded.assets[0];expect(await exists(localPath(file.file))).toBe(true);
    const ranged=await handle(new Request("http://localhost:3000/x",{headers:{Range:"bytes=0-9"}}),["projects",p.id,"assets",file.id]);
    expect(ranged.status).toBe(206);expect((await ranged.arrayBuffer()).byteLength).toBe(10);
    const cross=await handle(new Request("http://localhost:3000/x",{headers:{Origin:"https://evil.example"}}),["settings"]);
    expect(cross.status).toBe(403);
    expect((await handle(new Request("https://public.example/x"),["settings"])).status).toBe(403);
  });
});
describe("paid job lifecycle using only mocked HTTP",()=>{
  it("deduplicates double-click and resumes a persisted provider ID, then uses local cache",async()=>{
    const p=await product();let statusCount=0;
    const fetcher=vi.fn(async(url:URL|string,init?:RequestInit)=>{
      if(init?.method==="POST"){
        const input=JSON.parse(init.body as string);
        expect(input).toHaveProperty("image_url");expect(input).not.toHaveProperty("duration");
        expect(input).not.toHaveProperty("image_urls");
        return Response.json({request_id:"fal-test-1",status_url:"https://queue.fal.run/fal-ai/wan/requests/fal-test-1/status",response_url:"https://queue.fal.run/fal-ai/wan/requests/fal-test-1"});
      }
      if(String(url).endsWith("/status")){
        const persisted=(await allJobs(p.id))[0];expect(persisted.requestId).toBe("fal-test-1");
        return Response.json({status:statusCount++===0?"IN_PROGRESS":"COMPLETED"});
      }
      return Response.json({video:{url:"https://cdn.example/video.mp4"}});
    });
    vi.stubGlobal("fetch",fetcher);
    const jobs=await Promise.all([enqueue(p.id,"video","scene1"),enqueue(p.id,"video","scene1")]);
    expect(jobs[0].id).toBe(jobs[1].id);await processJob(jobs[0]);
    const resumed=await readJSON<Job>(jobPath(jobs[0].id));expect(resumed.status).toBe("polling");
    await processJob(resumed);expect(resumed.status).toBe("succeeded");
    const completed=await readProject(p.id);expect(await exists(localPath(assetById(completed,completed.scenes[0].videoId!).file))).toBe(true);
    const before=fetcher.mock.calls.length;const cached=await enqueue(p.id,"video","scene1");await processJob(cached);
    expect(cached.cached).toBe(true);expect(fetcher.mock.calls.length).toBe(before);
    expect(fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
  });
  it("never resubmits on polling failure and allows retry with the same ID",async()=>{
    const p=await product();let fail=true;
    const fetcher=vi.fn(async(url:URL|string,init?:RequestInit)=>{
      if(init?.method==="POST")return Response.json({request_id:"fal-existing",status_url:"https://queue.fal.run/fal-ai/wan/requests/fal-existing/status",response_url:"https://queue.fal.run/fal-ai/wan/requests/fal-existing"});
      if(fail)throw new Error("network lost");
      return Response.json(String(url).endsWith("/status")?{status:"COMPLETED"}:{video:{url:"https://cdn.example/video.mp4"}});
    });vi.stubGlobal("fetch",fetcher);
    const j=await enqueue(p.id,"video","scene1");await processJob(j);expect(j.status).toBe("failed");
    fail=false;
    // Even clicking the ordinary create button resumes the old paid request.
    const retry=await enqueue(p.id,"video","scene1");expect(retry.id).toBe(j.id);
    expect(retry.requestId).toBe("fal-existing");await processJob(retry);
    expect(retry.status).toBe("succeeded");
    expect(fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
  });
  it("marks ambiguous submit as uncertain and blocks a second paid job",async()=>{
    const p=await product();vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("connection reset")));
    const j=await enqueue(p.id,"video","scene1");await processJob(j);expect(j.status).toBe("uncertain");
    await expect(enqueue(p.id,"video","scene1",true)).rejects.toThrow("Lần submit trước");
    await expect(retryJob(j.id)).rejects.toThrow("request ID");
    const recovered=await retryJob(j.id,"recovered-id");expect(recovered.requestId).toBe("recovered-id");
    expect(recovered.statusURL).toBe("https://queue.fal.run/fal-ai/wan/requests/recovered-id/status");
  });
  it("treats authentication rejection as a failed unsubmitted job, not an ambiguous charge",async()=>{
    const p=await product();vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(null,{status:401})));
    const j=await enqueue(p.id,"video","scene1");await processJob(j);
    expect(j.status).toBe("failed");expect(j.phase).toBeUndefined();expect(j.requestId).toBeUndefined();
    expect((await retryJob(j.id)).status).toBe("queued");
  });
  it("requires an explicit regenerate after a terminal provider error",async()=>{
    const p=await product();
    vi.stubGlobal("fetch",vi.fn(async(_url:URL|string,init?:RequestInit)=>Response.json(init?.method==="POST"?
      {request_id:"terminal",status_url:"https://queue.fal.run/fal-ai/wan/requests/terminal/status",response_url:"https://queue.fal.run/fal-ai/wan/requests/terminal"}:
      {status:"COMPLETED",error:"model error"})));
    const j=await enqueue(p.id,"video","scene1");await processJob(j);expect(j.providerFailed).toBe(true);
    await expect(enqueue(p.id,"video","scene1")).rejects.toThrow("Tạo lại");
    const next=await enqueue(p.id,"video","scene1",true);expect(next.id).not.toBe(j.id);
  });
  it("crash during submit never automatically sends a new request",async()=>{
    const p=await product();const j=await enqueue(p.id,"video","scene1");j.phase="submitting";j.status="running";
    await atomicJSON(jobPath(j.id),j);const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    await processJob(await readJSON<Job>(jobPath(j.id)));
    expect((await readJSON<Job>(jobPath(j.id))).status).toBe("uncertain");expect(fetcher).not.toHaveBeenCalled();
  });
  it("counts a provider job between polls against the concurrency limit",async()=>{
    const first=await product();const second=await product();
    const fetcher=vi.fn(async(_url:URL|string,init?:RequestInit)=>Response.json(init?.method==="POST"?
      {request_id:"occupied",status_url:"https://queue.fal.run/fal-ai/wan/requests/occupied/status",response_url:"https://queue.fal.run/fal-ai/wan/requests/occupied"}:{status:"IN_PROGRESS"}));
    vi.stubGlobal("fetch",fetcher);
    const one=await enqueue(first.id,"video","scene1");const two=await enqueue(second.id,"video","scene1");
    const controller=new AbortController();const worker=startWorker(controller.signal);
    try {
      await vi.waitFor(async()=>expect((await readJSON<Job>(jobPath(one.id))).status).toBe("polling"),{timeout:4000});
      await new Promise(resolve=>setTimeout(resolve,800));
      expect((await readJSON<Job>(jobPath(two.id))).status).toBe("queued");
      expect(fetcher.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
    } finally {controller.abort();await worker;}
  },10000);
  it("missing cache files aren't reused and cache deletion preserves project assets",async()=>{
    const p=await product();await attachVideo(p);const j=await enqueue(p.id,"compose");await processJob(j);
    expect(j.status).toBe("succeeded");const persisted=await readProject(p.id);const final=assetById(persisted,persisted.finalId!);
    const cached=await getCache(j.key);expect(cached).not.toBeNull();
    await rm(localPath(cached!.file!));expect(await getCache(j.key)).toBeNull();
    await clearCache();expect(await exists(localPath(final.file))).toBe(true);
    expect((await readProject(p.id)).primaryId).toBe(p.primaryId);
  });
});
describe("real FFmpeg composition without provider calls",()=>{
  it("exports a silent MP4 and only recomposes when audio changes",async()=>{
    const p=await product();const clip=await attachVideo(p);const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    const silent=await enqueue(p.id,"compose");await processJob(silent);expect(silent.status).toBe("succeeded");
    const saved=await readProject(p.id);expect((await probe(localPath(assetById(saved,saved.finalId!).file))).audio).toBe(false);
    const audioFile=path.join(root,"normalized.m4a");const audioDuration=await extractAudio(path.join(fixture,"voice.wav"),audioFile);
    const voice=await importAsset(saved,audioFile,"audio","audio/mp4","voice",audioDuration);voice.narration="Đây là một sản phẩm có màu xanh.";
    saved.audio={...saved.audio,enabled:true,source:"tts",audioId:voice.id,volume:0.5,subtitles:true};await saveProject(saved);
    const mixed=await enqueue(p.id,"compose");expect(mixed.key).not.toBe(silent.key);await processJob(mixed);
    expect(mixed.status).toBe("succeeded");const final=await readProject(p.id);
    expect(final.scenes[0].videoId).toBe(clip.id);
    expect((await probe(localPath(assetById(final,final.finalId!).file))).audio).toBe(true);expect(fetcher).not.toHaveBeenCalled();
  },30000);
  it("blocks longer audio with extend selected instead of calling Wan",async()=>{
    const p=await product();const clip=await attachVideo(p);
    const audioFile=path.join(root,"voice.m4a");await extractAudio(path.join(fixture,"voice.wav"),audioFile);
    const voice=await importAsset(p,audioFile,"audio","audio/mp4","voice",2);p.audio={...p.audio,enabled:true,audioId:voice.id,overflow:"extend"};
    const output=path.join(root,"output.mp4");await expect(compose(p,[clip],output)).rejects.toThrow("Không gọi Wan tự động");
  });
  it("cache maintenance won't delete an in-flight result",async()=>{
    const p=await product();await enqueue(p.id,"video","scene1");
    await expect(clearCache()).rejects.toThrow("job đang");
  });
});
