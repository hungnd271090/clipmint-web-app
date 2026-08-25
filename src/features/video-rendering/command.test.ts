import { describe, expect, it } from "vitest";
import { buildRenderCommand } from "@/features/video-rendering/command";
import type { VideoPlan } from "@/lib/api/client";

const plan: VideoPlan = {
  version: 1,
  durationSeconds: 15,
  voiceScript: "Một video thử nghiệm.",
  scenes: [
    { sourceStartSeconds: 0, sourceEndSeconds: 7.5, outputStartSeconds: 0, outputEndSeconds: 7.5, purpose: "Hook" },
    { sourceStartSeconds: 10, sourceEndSeconds: 17.5, outputStartSeconds: 7.5, outputEndSeconds: 15, purpose: "Demo" },
  ],
  subtitles: [],
  overlays: [],
};

describe("buildRenderCommand", () => {
  it("encodes an MP4 that browsers can decode", () => {
    const command = buildRenderCommand({ sourcePath: "source.mp4", voicePath: "voice.mp3", plan });

    expect(option(command, "-c:v")).toBe("libx264");
    expect(option(command, "-pix_fmt")).toBe("yuv420p");
    expect(option(command, "-profile:v")).toBe("main");
    expect(option(command, "-tag:v")).toBe("avc1");
    expect(option(command, "-c:a")).toBe("aac");
    expect(option(command, "-ar")).toBe("48000");
    expect(option(command, "-movflags")).toBe("+faststart");
    expect(option(command, "-f")).toBe("mp4");
  });

  it("keeps every planned scene in the concat filter", () => {
    const command = buildRenderCommand({ sourcePath: "source.mp4", voicePath: "voice.mp3", plan });
    const filter = option(command, "-filter_complex");

    expect(filter).toContain("trim=start=0:end=7.5");
    expect(filter).toContain("trim=start=10:end=17.5");
    expect(filter).toContain("concat=n=2:v=1:a=0");
  });
});

function option(command: string[], name: string): string {
  const index = command.indexOf(name);
  if (index < 0 || !command[index + 1]) throw new Error(`Missing ${name}`);
  return command[index + 1];
}
