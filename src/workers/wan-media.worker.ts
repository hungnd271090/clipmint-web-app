/// <reference lib="webworker" />
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { composition, type MediaInfo } from "@/features/wan/browser/command";
import type { MediaTask } from "@/features/wan/browser/media";
self.onmessage=async({data:task}:MessageEvent<MediaTask>)=>{
  const ff=new FFmpeg();const urls:string[]=[];
  try{
    const origin=self.location.origin;
    const coreURL=await toBlobURL(origin+"/ffmpeg/ffmpeg-core.js","text/javascript");urls.push(coreURL);
    const wasmURL=await toBlobURL(origin+"/ffmpeg/ffmpeg-core.wasm","application/wasm");urls.push(wasmURL);
    await ff.load({coreURL,wasmURL});
    for(const f of task.files)await ff.writeFile(f.name,new Uint8Array(f.buffer));
    async function probe(name:string):Promise<MediaInfo>{
      await ff.deleteFile("probe.json").catch(()=>{});
      const exit=await ff.ffprobe(["-v","error","-protocol_whitelist","file,pipe","-show_format","-show_streams","-of","json",name,"-o","probe.json"]);
      // core 0.12.10 leaves ret=-1 on successful ffprobe; validate fresh JSON rather than reject that sentinel.
      if(exit>0)throw new Error("Không decode được media.");
      const result=await ff.readFile("probe.json");const p=JSON.parse(typeof result==="string"?result:new TextDecoder().decode(result));
      const duration=Number(p.format?.duration);const v=p.streams?.find((s:{codec_type:string})=>s.codec_type==="video");
      if(!Number.isFinite(duration)||duration<=0||duration>3600)throw new Error("Media tối đa 60 phút, thời lượng phải hợp lệ.");
      return {duration,video:!!v,audio:!!p.streams?.some((s:{codec_type:string})=>s.codec_type==="audio"),width:v?.width||0,height:v?.height||0};
    }
    let output="";
    if(task.action==="probe"){
      const info=await probe(task.files[0].name);
      if(!info.video)throw new Error("Provider không trả video.");
      if(await ff.exec(["-v","error","-xerror","-protocol_whitelist","file,pipe","-i",task.files[0].name,"-map","0:v:0","-an","-f","null","-"])!==0)throw new Error("Video bị hỏng.");
      self.postMessage({type:"done",info});return;
    }
    if(task.action==="extract"){
      const input=task.files[0].name;if(!(await probe(input)).audio)throw new Error("File không có audio. URL không hỗ trợ hãy upload MP3/WAV/M4A.");
      output="output.m4a";
      if(await ff.exec(["-v","error","-xerror","-y","-protocol_whitelist","file,pipe","-i",input,"-vn","-map","0:a:0","-c:a","aac","-b:a","192k",output])!==0)throw new Error("Không trích xuất được audio.");
    }else{
      const p=task.project!;const infos=await Promise.all(p.scenes.map((_,i)=>probe("video-"+i)));
      const voice=p.audio.enabled?{info:await probe("voice"),narration:task.narration}:undefined;
      if(voice && !voice.info.audio)throw new Error("File giọng không có audio.");
      const music=p.audio.enabled&&!!p.audio.musicId;if(music && !(await probe("music")).audio)throw new Error("Nhạc không có audio.");
      const plan=composition(p,infos,voice,music);
      if(plan.captions){await ff.writeFile("captions.srt",new TextEncoder().encode(plan.captions));await ff.createDir("fonts");const r=await fetch(origin+"/ffmpeg/DejaVuSans.ttf");if(!r.ok)throw new Error("Thiếu font phụ đề.");await ff.writeFile("fonts/DejaVuSans.ttf",new Uint8Array(await r.arrayBuffer()));}
      if(await ff.exec(plan.args)!==0)throw new Error("Ghép media thất bại. Thử file nhỏ hơn hoặc ít cảnh hơn.");output="output.mp4";
    }
    const info=await probe(output);const bytes=await ff.readFile(output);if(typeof bytes==="string")throw new Error("Output không hợp lệ.");
    const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;self.postMessage({type:"done",info,buffer},[buffer]);
  }catch(e){self.postMessage({type:"error",message:e instanceof Error?e.message:"FFmpeg WASM thất bại."});}
  finally{ff.terminate();urls.forEach(u=>URL.revokeObjectURL(u));}
};
export {};
