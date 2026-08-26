/// <reference lib="webworker" />

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { buildMotionRenderCommand } from "@/features/video-rendering/motion-command";
import type { MotionVideoPlan } from "@/lib/api/client";

type RenderMessage = {
  assetBuffers: ArrayBuffer[];
  assetTypes: string[];
  voiceBuffer: ArrayBuffer;
  voiceType: string;
  plan: MotionVideoPlan;
  subtitleStyle: string;
};

self.onmessage = async (event: MessageEvent<RenderMessage>) => {
  const { assetBuffers, assetTypes, voiceBuffer, voiceType, plan, subtitleStyle } = event.data;
  const ffmpeg = new FFmpeg();
  try {
    self.postMessage({ type: "progress", progress: 0.05, stage: "Khởi tạo bộ dựng motion video" });
    const origin = self.location.origin;
    await ffmpeg.load({
      coreURL: await toBlobURL(`${origin}/ffmpeg/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${origin}/ffmpeg/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpeg.on("progress", ({ progress }) => self.postMessage({ type: "progress", progress: 0.18 + Math.min(0.77, progress * 0.77), stage: "Đang tạo chuyển động và chèn phụ đề" }));

    const assetPaths: string[] = [];
    for (let index = 0; index < assetBuffers.length; index++) {
      const extension = assetTypes[index]?.includes("png") ? "png" : assetTypes[index]?.includes("webp") ? "webp" : "jpg";
      const path = `asset-${index}.${extension}`;
      assetPaths.push(path);
      await ffmpeg.writeFile(path, new Uint8Array(assetBuffers[index]));
    }
    const voiceExt = voiceType.includes("wav") ? "wav" : "mp3";
    await ffmpeg.writeFile(`voice.${voiceExt}`, new Uint8Array(voiceBuffer));
    await ffmpeg.writeFile("subtitles.ass", new TextEncoder().encode(toASS(plan, subtitleStyle)));
    await ffmpeg.exec(buildMotionRenderCommand({ assetPaths, voicePath: `voice.${voiceExt}`, plan }));

    const output = await ffmpeg.readFile("output.mp4");
    if (typeof output === "string") throw new Error("FFmpeg trả về dữ liệu không hợp lệ.");
    const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    self.postMessage({ type: "done", buffer }, [buffer]);
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "Không thể dựng motion video." });
  } finally {
    ffmpeg.terminate();
  }
};

function toASS(plan: MotionVideoPlan, style: string): string {
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
