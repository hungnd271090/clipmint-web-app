import type { Job, Project, Settings } from "@/features/wan/types";
import { capabilities } from "@/features/wan/types";
import { defaults } from "@/features/wan/defaults";
import { publicSettings, validateSettings } from "@/server/wan/settings";
import { advertisingCopy, editImage, FalHTTPError, FalJobError, OpenAIHTTPError, improve, pollVideo, submitVideo, suggest, tts, videoParams } from "@/server/wan/providers";
import { downloadURL } from "@/server/wan/network";
import { validateImage } from "@/server/wan/media";
import { WanError } from "@/server/wan/storage";
export const runtime="nodejs";
export const maxDuration=300;
const environment=():Settings=>({...defaults,falKey:process.env.FAL_KEY||"",openaiKey:process.env.OPENAI_API_KEY||""});
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"no-store"}});
function binary(bytes:Buffer,type:string){
  // Stream in bounded chunks: media outputs can exceed Vercel's buffered response limit.
  let offset=0;
  return new Response(new ReadableStream({pull(controller){if(offset>=bytes.length){controller.close();return;}const end=Math.min(offset+64*1024,bytes.length);controller.enqueue(new Uint8Array(bytes.subarray(offset,end)));offset=end;}}),{headers:{"Content-Type":type,"Cache-Control":"no-store"}});
}
export async function GET(){return json({settings:publicSettings(environment())});}
export async function POST(request:Request,{params}:{params:Promise<{action:string}>}){
  try{
    const origin=request.headers.get("origin");if((origin && new URL(origin).host!==new URL(request.url).host)||request.headers.get("sec-fetch-site")==="cross-site")throw new WanError("Origin không hợp lệ.",403);
    const {action}=await params;
    if(!["test","suggest","improve","copy","image","tts","submit","poll","download"].includes(action))throw new WanError("Bước không hợp lệ.");
    const raw=await request.text();if(raw.length>3_800_000)throw new WanError("Ảnh tham chiếu vượt giới hạn request.",413);
    const b=JSON.parse(raw);const s={...environment()};
    for(const key of Object.keys(defaults) as (keyof Settings)[]){if(b.settings?.[key]!==undefined && !["falKey","openaiKey"].includes(key))Object.assign(s,{[key]:b.settings[key]});}
    for(const key of ["falKey","openaiKey"] as const){if(typeof b.settings?.[key]==="string" && b.settings[key].trim()){if(b.settings[key].length>500)throw new WanError("Key không hợp lệ.");s[key]=b.settings[key].trim();}}
    validateSettings(s);
    if(action==="test")return json({message:"Schema và cấu hình hợp lệ. File lưu trên máy bạn; không cần Blob. Không gọi inference nên chưa xác minh key/quota.",settings:publicSettings(s)});
    if(action==="download")return binary(await downloadURL(b.url,150*1024*1024),"application/octet-stream");
    if(action==="poll"){
      if(typeof b.requestId!=="string" || !/^[\w-]{1,150}$/.test(b.requestId))throw new WanError("Request ID không hợp lệ.");
      // Registered endpoint uses the fal-ai/wan queue namespace. Never accept arbitrary credential-bearing URLs.
      const base="https://queue.fal.run/fal-ai/wan/requests/"+b.requestId;
      const url=await pollVideo(s,{statusURL:base+"/status",responseURL:base} as Job);return json({url});
    }
    const p=b.project as Project;
    if(!p || !Array.isArray(p.assets) || p.assets.length>100 || !Array.isArray(p.scenes) || p.scenes.length>8 || !capabilities.ratios.includes(p.ratio) || !capabilities.resolutions.includes(p.resolution))throw new WanError("Project không hợp lệ.");
    for(const value of [p.name,p.features,p.message,p.audio?.text,...p.scenes.flatMap(v=>[v.prompt,v.motion])])if(typeof value!=="string" || value.length>5000)throw new WanError("Nội dung không hợp lệ.");
    if(!capabilities.voices.includes(p.audio.voice) || !["vi","en"].includes(p.audio.language) || !Number.isFinite(p.audio.speed) || p.audio.speed<0.25 || p.audio.speed>4)throw new WanError("Giọng đọc không hợp lệ.");
    const refs=b.images as {id:string;data:string}[];
    if(!Array.isArray(refs) || refs.length>8)throw new WanError("Tối đa 8 ảnh tham chiếu.");
    const buffers=new Map<string,Buffer>();
    for(const ref of refs){if(typeof ref.data!=="string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(ref.data))throw new WanError("Ảnh tham chiếu không hợp lệ.");const bytes=Buffer.from(ref.data.split(",")[1],"base64");const mime=await validateImage(bytes);const a=p.assets.find(a=>a.id===ref.id);if(!a)throw new WanError("Ảnh không thuộc project.");a.mime=mime;buffers.set(ref.id,bytes);}
    const read=async(a:Project["assets"][number])=>{const bytes=buffers.get(a.id);if(!bytes)throw new WanError("Thiếu ảnh tham chiếu.");return bytes;};
    const scene=p.scenes.find(v=>v.id===b.sceneId);
    if(["improve","image","submit"].includes(action) && !scene)throw new WanError("Thiếu cảnh.");
    if(action==="suggest")return json({data:await suggest(s,p,read)});
    if(action==="improve")return json({data:await improve(s,p,scene!,read)});
    if(action==="copy")return json({data:await advertisingCopy(s,p,read)});
    if(action==="image")return binary(await editImage(s,p,scene!,read),"image/png");
    if(action==="tts")return binary(await tts(s,p),"audio/mpeg");
    // One input image only. No duration field or multi-image Wan assumption.
    return json(await submitVideo(s,{snapshot:p,sceneId:scene!.id,model:s.endpoint,params:videoParams(s,p,scene!)} as unknown as Job,read));
  }catch(e){return json({error:e instanceof WanError?e.message:"Không thực hiện được yêu cầu. Kiểm tra kết nối/provider; URL cần đăng nhập hãy upload file.",providerFailed:e instanceof FalJobError,definitive:(e instanceof FalHTTPError || e instanceof OpenAIHTTPError) && [400,401,403,404,405,413,422,429].includes(e.httpStatus)},e instanceof WanError?e.status:502);}
}
