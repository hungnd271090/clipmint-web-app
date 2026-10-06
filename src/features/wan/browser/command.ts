import type { Project } from "../types";
function timestamp(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return [Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(v => String(v).padStart(2,"0")).join(":") + "," + String(ms%1000).padStart(3,"0");
}
// TTS doesn't expose word timings. Distribute short verbatim chunks over speech duration.
// The UI labels this approximation; trim offsets are applied to the original narration.
export function subtitles(text: string, duration: number, start: number, end: number) {
  const words = text.replace(/[<>{}\\]/g,"").trim().split(/\s+/); const lines: string[] = [];
  for (let i=0; i<words.length; i+=7) {
    const from = Math.max(start, duration * i/words.length);
    const to = Math.min(end, duration * Math.min(words.length,i+7)/words.length);
    if (to > from) lines.push(String(lines.length+1) + "\n" + timestamp(from-start) + " --> " + timestamp(to-start) + "\n" + words.slice(i,i+7).join(" ") + "\n");
  }
  return lines.join("\n");
}

export interface MediaInfo { duration:number; video:boolean; audio:boolean; width:number; height:number }
export function composition(p:Project,infos:MediaInfo[],voice?:{info:MediaInfo;narration?:string},music=false){
  if(!infos.length || infos.some(v=>!v.video))throw new Error("Chưa có video cảnh hợp lệ.");
  const duration=infos.reduce((n,v)=>n+v.duration,0);
  const height=p.resolution==="480p"?480:p.resolution==="580p"?580:720;
  const ratio=p.ratio==="auto"?infos[0].width/infos[0].height:p.ratio==="16:9"?16/9:p.ratio==="1:1"?1:9/16;
  const width=Math.round(height*ratio/2)*2;
  const args=["-v","error","-y"];const filters:string[]=[];
  infos.forEach((_,i)=>{args.push("-protocol_whitelist","file,pipe","-i","video-"+i);filters.push("["+i+":v:0]scale="+width+":"+height+":force_original_aspect_ratio=decrease,pad="+width+":"+height+":(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p,setpts=PTS-STARTPTS[v"+i+"]");});
  filters.push(infos.map((_,i)=>"[v"+i+"]").join("")+"concat=n="+infos.length+":v=1:a=0[joined]");
  let out="[joined]";const tracks:string[]=[];let captions="";
  if(voice && p.audio.enabled){
    const end=Math.min(p.audio.end??voice.info.duration,voice.info.duration);
    if(end<=p.audio.start)throw new Error("Đoạn audio không hợp lệ.");
    if(end-p.audio.start>duration+0.1 && p.audio.overflow==="extend")throw new Error("Audio dài hơn video. Chủ động thêm và tạo cảnh hoặc chọn cắt audio; không tự gọi Wan.");
    args.push("-protocol_whitelist","file,pipe","-i","voice");filters.push("["+infos.length+":a:0]atrim=start="+p.audio.start+":end="+end+",asetpts=PTS-STARTPTS,volume="+p.audio.volume+",apad,atrim=duration="+duration+"[voice]");tracks.push("[voice]");
    if(p.audio.subtitles){
      if(!voice.narration)throw new Error("Phụ đề cần lời thoại của giọng đã duyệt.");
      captions=subtitles(voice.narration,voice.info.duration,p.audio.start,Math.min(end,p.audio.start+duration));
      filters.push("[joined]subtitles=filename=captions.srt:fontsdir=fonts:force_style='FontName=DejaVu Sans,FontSize=18,Outline=1,Alignment=2,MarginV=35'[captioned]");out="[captioned]";
    }
  }
  if(music && p.audio.enabled){args.push("-stream_loop","-1","-protocol_whitelist","file,pipe","-i","music");filters.push("["+(infos.length+(voice?1:0))+":a:0]asetpts=PTS-STARTPTS,volume="+p.audio.musicVolume+",atrim=duration="+duration+"[music]");tracks.push("[music]");}
  if(tracks.length)filters.push(tracks.join("")+"amix=inputs="+tracks.length+":duration=longest:normalize=0,alimiter=limit=0.95[audio]");
  args.push("-filter_complex",filters.join(";"),"-map",out);
  if(tracks.length)args.push("-map","[audio]","-c:a","aac","-b:a","192k");else args.push("-an");
  args.push("-t",String(duration),"-c:v","libx264","-preset","veryfast","-crf","20","-pix_fmt","yuv420p","-movflags","+faststart","output.mp4");
  return {args,captions,duration};
}
