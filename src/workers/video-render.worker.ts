/// <reference lib="webworker" />

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import type { VideoPlan } from "@/lib/api/client";

type RenderMessage = { sourceBuffer: ArrayBuffer; sourceName: string; voiceBuffer: ArrayBuffer; voiceType: string; plan: VideoPlan; subtitleStyle: string };

self.onmessage = async (event: MessageEvent<RenderMessage>) => {
  const { sourceBuffer, sourceName, voiceBuffer, voiceType, plan, subtitleStyle } = event.data;
  const ffmpeg = new FFmpeg();
  try {
    self.postMessage({ type: "progress", progress: 0.05, stage: "Khởi tạo bộ dựng video" });
    const origin = self.location.origin;
    await ffmpeg.load({
      coreURL: await toBlobURL(`${origin}/ffmpeg/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${origin}/ffmpeg/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpeg.on("progress", ({ progress }) => self.postMessage({ type: "progress", progress: 0.2 + Math.min(0.75, progress * 0.75), stage: "Đang dựng và chèn phụ đề" }));
    const sourceExt = sourceName.toLowerCase().endsWith(".mov") ? "mov" : "mp4";
    const voiceExt = voiceType.includes("wav") ? "wav" : "mp3";
    await ffmpeg.writeFile(`source.${sourceExt}`, new Uint8Array(sourceBuffer));
    await ffmpeg.writeFile(`voice.${voiceExt}`, new Uint8Array(voiceBuffer));
    await ffmpeg.writeFile("subtitles.ass", new TextEncoder().encode(toASS(plan, subtitleStyle)));

    const trims = plan.scenes.map((scene, index) => `[0:v]trim=start=${scene.sourceStartSeconds}:end=${scene.sourceEndSeconds},setpts=PTS-STARTPTS[v${index}]`).join(";");
    const streams = plan.scenes.map((_, index) => `[v${index}]`).join("");
    const filter = `${trims};${streams}concat=n=${plan.scenes.length}:v=1:a=0,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,subtitles=subtitles.ass[outv]`;
    await ffmpeg.exec([
      "-i", `source.${sourceExt}`, "-i", `voice.${voiceExt}`,
      "-filter_complex", filter,
      "-map", "[outv]", "-map", "1:a:0",
      "-t", String(plan.durationSeconds),
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", "output.mp4",
    ]);
    const output = await ffmpeg.readFile("output.mp4");
    if (typeof output === "string") throw new Error("FFmpeg trả về dữ liệu không hợp lệ.");
    const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    self.postMessage({ type: "done", buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "Không thể dựng video." });
  } finally {
    ffmpeg.terminate();
  }
};

function toASS(plan: VideoPlan, style: string): string {
  const primary = style === "minimal" ? "&H00FFFFFF" : style === "bold" ? "&H0000E7FF" : "&H007AF0D0";
  const lines = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Default,Arial,64,${primary},&H00FFFFFF,&H00101816,&H66000000,-1,0,0,0,100,100,0,0,1,4,1,2,80,80,160,1`,
    "Style: Overlay,Arial,54,&H00FFFFFF,&H00FFFFFF,&H00101816,&H88000000,-1,0,0,0,100,100,0,0,3,2,0,8,70,70,110,1", "",
    "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];
  for (const subtitle of plan.subtitles) lines.push(`Dialogue: 0,${assTime(subtitle.startSeconds)},${assTime(subtitle.endSeconds)},Default,,0,0,0,,${escapeASS(subtitle.text)}`);
  for (const overlay of plan.overlays) {
    const alignment = overlay.position === "bottom" ? "{\\an2}" : overlay.position === "center" ? "{\\an5}" : "{\\an8}";
    lines.push(`Dialogue: 1,${assTime(overlay.startSeconds)},${assTime(overlay.endSeconds)},Overlay,,0,0,0,,${alignment}${escapeASS(overlay.text)}`);
  }
  return lines.join("\n");
}

function assTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = (seconds % 60).toFixed(2).padStart(5, "0");
  return `${hours}:${String(minutes).padStart(2, "0")}:${remaining}`;
}

function escapeASS(value: string): string { return value.replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\n/g, "\\N"); }

export {};

