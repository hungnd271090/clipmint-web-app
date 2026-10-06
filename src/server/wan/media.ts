import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Project, Asset } from "../../features/wan/types";
import { assetById, localPath, WanError } from "./storage";

export async function run(binary: string, args: string[], cwd?: string, timeout = 180_000): Promise<string> {
  return new Promise((resolve,reject) => {
    const child = spawn(binary, args, { shell: false, cwd, windowsHide: true });
    let stdout = ""; let stderr = ""; let settled = false;
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new WanError("Xử lý media quá thời gian.")); }, timeout);
    function finish(error?: Error) { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(stdout); }
    child.stdout.on("data", d => { stdout = (stdout + String(d)).slice(-2_000_000); });
    child.stderr.on("data", d => { stderr = (stderr + String(d)).slice(-4000); });
    child.on("error", e => finish(new WanError((e as NodeJS.ErrnoException).code === "ENOENT" ?
      "Thiếu " + binary + ". Cài FFmpeg (kèm ffprobe), thêm vào PATH rồi khởi động lại worker." : "Không chạy được công cụ xử lý media.")));
    child.on("close", code => finish(code === 0 ? undefined : new WanError("Media không decode/xử lý được. " + stderr.replace(/https?:\/\/\S+/g, "[URL]").slice(-500))));
  });
}
export async function dependencies() {
  const result = await Promise.all(["ffmpeg","ffprobe"].map(async name => ({ name, available: await run(name, ["-version"]).then(() => true).catch(() => false) })));
  return { tools: result, instructions: "Windows: winget install Gyan.FFmpeg; macOS: brew install ffmpeg; Ubuntu: sudo apt install ffmpeg. Khởi động lại terminal/worker sau khi cài." };
}
export interface Probe { duration: number; video: boolean; audio: boolean; width: number; height: number }
export async function probe(file: string): Promise<Probe> {
  const p = JSON.parse(await run("ffprobe", ["-v","error","-protocol_whitelist","file,pipe","-show_format","-show_streams","-of","json",file]));
  const video = p.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
  const duration = Number(p.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new WanError("Thời lượng media không hợp lệ hoặc trên 60 phút.");
  return { duration, video: !!video, audio: !!p.streams?.some((s: { codec_type: string }) => s.codec_type === "audio"), width: video?.width ?? 0, height: video?.height ?? 0 };
}
export async function validateImage(bytes: Buffer) {
  try {
    const decoder = sharp(bytes, { limitInputPixels: 40_000_000, animated: false });
    const metadata = await decoder.metadata();
    if (!["jpeg","png","webp"].includes(metadata.format || "") || !metadata.width || !metadata.height ||
        metadata.width < 64 || metadata.height < 64 || (metadata.pages || 1) > 1) throw new Error();
    await decoder.raw().toBuffer(); // Validate full decode, not just extension/header.
    return metadata.format === "jpeg" ? "image/jpeg" : "image/" + metadata.format;
  } catch { throw new WanError("Ảnh phải là JPEG, PNG hoặc WebP không động, decode được, tối thiểu 64px và tối đa 40 megapixel."); }
}
export async function validateVideo(file: string) {
  const info = await probe(file); if (!info.video) throw new WanError("Provider không trả về video hợp lệ.");
  await run("ffmpeg", ["-v","error","-xerror","-protocol_whitelist","file,pipe","-i",file,"-map","0:v:0","-an","-f","null","-"], undefined, 300_000);
  return info;
}
export async function extractAudio(input: string, output: string) {
  const info = await probe(input);
  if (!info.audio) throw new WanError("File/video không có track audio. Hãy upload MP3, WAV hoặc M4A khác.");
  await run("ffmpeg", ["-v","error","-xerror","-y","-protocol_whitelist","file,pipe","-i",input,"-vn","-map","0:a:0","-c:a","aac","-b:a","192k",output]);
  return (await probe(output)).duration;
}
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
export async function compose(p: Project, videos: Asset[], output: string) {
  if (!videos.length) throw new WanError("Chưa có video cảnh.");
  const infos = await Promise.all(videos.map(v => probe(localPath(v.file))));
  const duration = infos.reduce((a,b) => a+b.duration,0);
  const voice = p.audio.enabled ? assetById(p,p.audio.audioId) : undefined;
  const music = p.audio.enabled && p.audio.musicId ? assetById(p,p.audio.musicId,"music") : undefined;
  let end = 0;
  if (voice) {
    if (!["audio"].includes(voice.kind)) throw new WanError("File giọng/audio không hợp lệ.");
    const voiceDuration = (await probe(localPath(voice.file))).duration;
    end = Math.min(p.audio.end ?? voiceDuration,voiceDuration);
    if (end <= p.audio.start) throw new WanError("Đoạn audio phải có điểm kết thúc lớn hơn điểm bắt đầu.");
    if (end-p.audio.start > duration+0.1 && p.audio.overflow === "extend")
      throw new WanError("Audio dài hơn video. Thêm cảnh và bấm tạo video cho cảnh đó, hoặc chọn cắt audio. Không gọi Wan tự động.");
  }
  const work = localPath("temp/" + randomUUID()); await mkdir(work,{ recursive:true });
  try {
    const args = ["-v","error","-y"];
    videos.forEach(v => args.push("-protocol_whitelist","file,pipe","-i",localPath(v.file)));
    const filters: string[] = [];
    const height = p.resolution === "480p" ? 480 : p.resolution === "580p" ? 580 : 720;
    const ratio = p.ratio === "auto" ? infos[0].width/infos[0].height : p.ratio === "16:9" ? 16/9 : p.ratio === "1:1" ? 1 : 9/16;
    const width = Math.round(height*ratio/2)*2;
    infos.forEach((_,i) => filters.push("[" + i + ":v:0]scale=" + width + ":" + height + ":force_original_aspect_ratio=decrease,pad=" + width + ":" + height + ":(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p,setpts=PTS-STARTPTS[v" + i + "]"));
    filters.push(infos.map((_,i) => "[v" + i + "]").join("") + "concat=n=" + videos.length + ":v=1:a=0[joined]");
    let videoOut = "[joined]"; const tracks: string[] = [];
    if (voice) {
      args.push("-protocol_whitelist","file,pipe","-i",localPath(voice.file));
      filters.push("[" + videos.length + ":a:0]atrim=start=" + p.audio.start + ":end=" + end + ",asetpts=PTS-STARTPTS,volume=" + p.audio.volume + ",apad,atrim=duration=" + duration + "[voice]");
      tracks.push("[voice]");
    }
    if (music) {
      args.push("-stream_loop","-1","-protocol_whitelist","file,pipe","-i",localPath(music.file));
      filters.push("[" + (videos.length+(voice?1:0)) + ":a:0]asetpts=PTS-STARTPTS,volume=" + p.audio.musicVolume + ",atrim=duration=" + duration + "[music]");
      tracks.push("[music]");
    }
    if (p.audio.subtitles && voice?.narration) {
      await writeFile(path.join(work,"captions.srt"),subtitles(voice.narration,voice.duration || end,p.audio.start,Math.min(end,p.audio.start+duration)));
      filters.push("[joined]subtitles=filename=captions.srt:force_style='FontSize=18,Outline=1,Alignment=2,MarginV=35'[captioned]");
      videoOut = "[captioned]";
    }
    if (tracks.length) filters.push(tracks.join("") + "amix=inputs=" + tracks.length + ":duration=longest:normalize=0,alimiter=limit=0.95[audio]");
    args.push("-filter_complex",filters.join(";"),"-map",videoOut);
    if (tracks.length) args.push("-map","[audio]","-c:a","aac","-b:a","192k");
    else args.push("-an");
    args.push("-t",String(duration),"-c:v","libx264","-preset","veryfast","-crf","20","-pix_fmt","yuv420p","-movflags","+faststart",output);
    await run("ffmpeg",args,work,600_000);
    return validateVideo(output);
  } finally { await rm(work,{ recursive:true,force:true }); }
}
