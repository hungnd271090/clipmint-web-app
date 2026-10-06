import type { AudioOptions, Project, Scene } from "../../features/wan/types";
import { capabilities } from "../../features/wan/types";
import { assertIdle } from "./jobs";
import { assetById, id, locked, readProject, saveProject, WanError } from "./storage";

function text(value: unknown,max=5000) {
  if (typeof value!=="string" || value.length>max) throw new WanError("Nội dung nhập không hợp lệ/quá dài."); return value;
}
function number(value: unknown,min: number,max: number) {
  if (typeof value!=="number" || !Number.isFinite(value) || value<min || value>max) throw new WanError("Giá trị số ngoài giới hạn."); return value;
}
export async function updateProject(projectId: string,input: Partial<Project>) {
  return locked("project-" + id(projectId),async()=>{
    await assertIdle(projectId);
    const p=await readProject(projectId);
    if (input.revision!==p.revision) throw new WanError("Project đã thay đổi. Tải lại dữ liệu trước khi lưu.",409);
    if (input.name!==undefined) p.name=text(input.name,300);
    if (input.features!==undefined) p.features=text(input.features);
    if (input.message!==undefined) p.message=text(input.message);
    if (input.primaryId!==undefined) {
      if (input.primaryId) assetById(p,input.primaryId,"image");
      else if (p.assets.some(a=>a.kind==="image")) throw new WanError("Hãy chọn ảnh chính.");
      p.primaryId=input.primaryId;
    }
    if (input.mode!==undefined) { if (!["suggest","manual"].includes(input.mode)) throw new WanError("Mode không hợp lệ."); p.mode=input.mode; }
    if (input.ratio!==undefined) { if (!capabilities.ratios.includes(input.ratio)) throw new WanError("Tỷ lệ chưa được endpoint hỗ trợ."); p.ratio=input.ratio; }
    if (input.resolution!==undefined) { if (!capabilities.resolutions.includes(input.resolution)) throw new WanError("Resolution không hợp lệ."); p.resolution=input.resolution; }
    if (input.scenes!==undefined) {
      if (!Array.isArray(input.scenes) || input.scenes.length>8 || new Set(input.scenes.map(s=>s.id)).size!==input.scenes.length) throw new WanError("Tối đa 8 cảnh, ID không trùng.");
      p.scenes=input.scenes.map(s=>{
        const old=p.scenes.find(v=>v.id===s.id);
        assetById(p,s.sourceId || p.primaryId,"image"); id(s.id);
        if (typeof s.original!=="boolean") throw new WanError("Lựa chọn ảnh không hợp lệ.");
        const scene: Scene={...old,id:s.id,name:text(s.name,300),prompt:text(s.prompt),motion:text(s.motion),
          original:s.original,sourceId:s.sourceId || p.primaryId};
        // Only existing project images can be selected. Generated-image cache key is server-owned.
        if (s.imageId && s.imageId!==old?.imageId) {
          assetById(p,s.imageId,"image"); scene.imageId=s.imageId;
          scene.imageKey=undefined; // A changed background needs an explicit original-source selection or a new edit.
        }
        return scene;
      });
    }
    if (input.audio!==undefined) {
      const a=input.audio as AudioOptions;
      if (typeof a.enabled!=="boolean" || typeof a.subtitles!=="boolean" ||
        !["upload","url","tts"].includes(a.source) || !["trim","extend"].includes(a.overflow) ||
        !["vi","en"].includes(a.language) || !capabilities.voices.includes(a.voice)) throw new WanError("Cấu hình audio không hợp lệ.");
      if (a.audioId) assetById(p,a.audioId,"audio");
      if (a.musicId) assetById(p,a.musicId,"music");
      p.audio={enabled:a.enabled,source:a.source,url:text(a.url,2000),text:text(a.text,4000),language:a.language,voice:a.voice,
        audioId:a.audioId,musicId:a.musicId,speed:number(a.speed,0.25,4),start:number(a.start,0,3600),
        end:a.end===null ? null : number(a.end,0,3600),volume:number(a.volume,0,3),musicVolume:number(a.musicVolume,0,3),
        subtitles:a.subtitles,overflow:a.overflow};
    }
    return saveProject(p);
  });
}
