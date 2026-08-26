import type { MotionVideoPlan } from "@/lib/api/client";

type Options = { assetPaths: string[]; voicePath: string; plan: MotionVideoPlan };

const TRANSITION_SECONDS = 0.35;
const SMART_MOTIONS = new Set(["depth-zoom", "parallax-left", "parallax-right", "light-sweep"]);

export function buildMotionRenderCommand({ assetPaths, voicePath, plan }: Options): string[] {
  const input: string[] = [];
  for (const [index, scene] of plan.scenes.entries()) {
    const sceneDuration = durationOf(scene) + (index < plan.scenes.length - 1 ? TRANSITION_SECONDS : 0);
    input.push("-loop", "1", "-framerate", "30", "-t", decimal(sceneDuration), "-i", assetPaths[scene.assetIndex]);
  }
  input.push("-i", voicePath);

  const filters: string[] = [];
  plan.scenes.forEach((scene, index) => {
    const sceneDuration = durationOf(scene) + (index < plan.scenes.length - 1 ? TRANSITION_SECONDS : 0);
    if (SMART_MOTIONS.has(scene.motion)) filters.push(...smartSceneFilters(index, scene.motion, sceneDuration));
    else filters.push(`[${index}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${motionFilter(scene.motion, sceneDuration)},trim=duration=${decimal(sceneDuration)},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[v${index}]`);
  });

  let current = "v0";
  let offset = durationOf(plan.scenes[0]);
  for (let index = 1; index < plan.scenes.length; index++) {
    const next = `x${index}`;
    filters.push(`[${current}][v${index}]xfade=transition=fade:duration=${TRANSITION_SECONDS}:offset=${decimal(offset)}[${next}]`);
    current = next;
    offset += durationOf(plan.scenes[index]);
  }
  filters.push(`[${current}]subtitles=subtitles.ass[outv]`);

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

function smartSceneFilters(index: number, motion: string, duration: number): string[] {
  const x = motion === "parallax-left"
    ? `(W-w)/2+28-56*t/${decimal(duration)}`
    : motion === "parallax-right" ? `(W-w)/2-28+56*t/${decimal(duration)}` : "(W-w)/2";
  const sweep = motion === "light-sweep"
    ? `,drawbox=x='-360+(iw+720)*t/${decimal(duration)}':y=0:w=260:h=ih:color=white@0.12:t=fill`
    : "";
  return [
    `[${index}:v]split=2[bg${index}][fg${index}]`,
    `[bg${index}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=24,eq=brightness=-0.08:saturation=1.12,zoompan=z='min(zoom+0.00025,1.04)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1080x1920:fps=30,trim=duration=${decimal(duration)},setpts=PTS-STARTPTS[bgm${index}]`,
    `[fg${index}]scale=920:1640:force_original_aspect_ratio=decrease,fps=30,trim=duration=${decimal(duration)},setpts=PTS-STARTPTS[fgm${index}]`,
    `[bgm${index}][fgm${index}]overlay=x='${x}':y='(H-h)/2+10*sin(t*0.8)':shortest=1${sweep},setsar=1,format=yuv420p[v${index}]`,
  ];
}

function motionFilter(motion: MotionVideoPlan["scenes"][number]["motion"], duration: number): string {
  const frames = Math.max(1, Math.round(duration * 30));
  const common = "d=1:s=1080x1920:fps=30";
  if (motion === "zoom-in") return `zoompan=z='min(zoom+0.0008,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${common}`;
  if (motion === "zoom-out") return `zoompan=z='if(eq(on,0),1.12,max(1,zoom-0.0008))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${common}`;
  if (motion === "pan-left") return `zoompan=z='1.12':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)':${common}`;
  if (motion === "pan-right") return `zoompan=z='1.12':x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)':${common}`;
  return `zoompan=z='1':x='0':y='0':${common}`;
}

function durationOf(scene: MotionVideoPlan["scenes"][number]) {
  return scene.outputEndSeconds - scene.outputStartSeconds;
}

function decimal(value: number) {
  return Number(value.toFixed(3)).toString();
}
