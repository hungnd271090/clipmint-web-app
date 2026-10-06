import type { Project } from "../types";
import type { MediaInfo } from "./command";
export type MediaTask={action:"probe"|"extract"|"compose";files:{name:string;buffer:ArrayBuffer}[];project?:Project;narration?:string};
export async function media(task:MediaTask):Promise<{blob?:Blob;info:MediaInfo}>{
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("../../../workers/wan-media.worker.ts",import.meta.url));
    const timer=setTimeout(()=>finish(new Error("FFmpeg WASM quá thời gian. Thử ít cảnh/file nhỏ hơn.")),15*60_000);
    function finish(error?:Error,result?:{blob?:Blob;info:MediaInfo}){clearTimeout(timer);worker.terminate();if(error)reject(error);else resolve(result!);}
    worker.onerror=()=>finish(new Error("Không tải được FFmpeg WASM. Reload, dùng Chrome/Edge và kiểm tra kết nối."));
    worker.onmessage=({data})=>{if(data.type==="error")finish(new Error(data.message));if(data.type==="done")finish(undefined,{info:data.info,blob:data.buffer?new Blob([data.buffer],{type:task.action==="compose"?"video/mp4":"audio/mp4"}):undefined});};
    worker.postMessage(task,task.files.map(v=>v.buffer));
  });
}
