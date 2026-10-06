import type { Project, Scene, Settings } from "./types";
export const normalize=(s:string)=>s.normalize("NFC").trim().replace(/\s+/g," ");
export const preservation = "Preserve the reference product's silhouette, proportions, color, logo placement and visible details as closely as possible. Change only the environment/lighting. Do not invent product specifications. Product identity may vary; the user must review the preview.";
export function videoParams(s: Settings,p: Project,scene: Scene) {
  return {prompt:"Scene: " + normalize(scene.prompt) + ". Motion: " + normalize(scene.motion) + ". " + preservation,
    resolution:p.resolution,aspect_ratio:p.ratio,acceleration:s.acceleration,video_quality:s.videoQuality,
    video_write_mode:s.videoWriteMode,enable_prompt_expansion:s.promptExpansion,
    enable_safety_checker:true,enable_output_safety_checker:true,...(s.seed===null ? {} : {seed:s.seed})};
}
