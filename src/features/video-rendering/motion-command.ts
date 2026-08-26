import type { MotionVideoPlan } from "@/lib/api/client";

type Options = { assetPaths: string[]; voicePath: string; plan: MotionVideoPlan };

export function buildMotionRenderCommand({ assetPaths, voicePath, plan }: Options): string[] {
  const input: string[] = [];
  for (const scene of plan.scenes) {
    input.push("-loop", "1", "-framerate", "30", "-t", String(scene.outputEndSeconds - scene.outputStartSeconds), "-i", assetPaths[scene.assetIndex]);
  }
  input.push("-i", voicePath);

  const filters = plan.scenes.map((scene, index) => {
    const duration = scene.outputEndSeconds - scene.outputStartSeconds;
    return `[${index}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${motionFilter(scene.motion, duration)},trim=duration=${duration},setpts=PTS-STARTPTS,setsar=1[v${index}]`;
  });
  const streams = plan.scenes.map((_, index) => `[v${index}]`).join("");
  filters.push(`${streams}concat=n=${plan.scenes.length}:v=1:a=0,subtitles=subtitles.ass[outv]`);

  return [
    ...input,
    "-filter_complex", filters.join(";"),
    "-map", "[outv]", "-map", `${plan.scenes.length}:a:0`,
    "-t", String(plan.durationSeconds),
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
    "-pix_fmt", "yuv420p", "-profile:v", "main", "-level:v", "4.0", "-tag:v", "avc1",
    "-af", "aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11,apad",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", "-f", "mp4", "output.mp4",
  ];
}

function motionFilter(motion: MotionVideoPlan["scenes"][number]["motion"], duration: number): string {
  const frames = Math.max(1, Math.round(duration * 30));
  const common = `d=1:s=1080x1920:fps=30`;
  if (motion === "zoom-in") return `zoompan=z='min(zoom+0.0008,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${common}`;
  if (motion === "zoom-out") return `zoompan=z='if(eq(on,0),1.12,max(1,zoom-0.0008))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${common}`;
  if (motion === "pan-left") return `zoompan=z='1.12':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)':${common}`;
  if (motion === "pan-right") return `zoompan=z='1.12':x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)':${common}`;
  return `zoompan=z='1':x='0':y='0':${common}`;
}
