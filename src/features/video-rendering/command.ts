import type { VideoPlan } from "@/lib/api/client";

type RenderCommandOptions = {
  sourcePath: string;
  voicePath: string;
  plan: VideoPlan;
};

export function buildRenderCommand({ sourcePath, voicePath, plan }: RenderCommandOptions): string[] {
  const trims = plan.scenes
    .map(
      (scene, index) =>
        `[0:v]trim=start=${scene.sourceStartSeconds}:end=${scene.sourceEndSeconds},setpts=PTS-STARTPTS[v${index}]`,
    )
    .join(";");
  const streams = plan.scenes.map((_, index) => `[v${index}]`).join("");
  const filter = `${trims};${streams}concat=n=${plan.scenes.length}:v=1:a=0,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,subtitles=subtitles.ass[outv]`;

  return [
    "-i",
    sourcePath,
    "-i",
    voicePath,
    "-filter_complex",
    filter,
    "-map",
    "[outv]",
    "-map",
    "1:a:0",
    "-t",
    String(plan.durationSeconds),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "23",
    // Browsers do not consistently decode H.264 with the yuv444p pixel format
    // that libx264 can otherwise select after the subtitle filter.
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "main",
    "-level:v",
    "4.0",
    "-tag:v",
    "avc1",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-shortest",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    "output.mp4",
  ];
}
