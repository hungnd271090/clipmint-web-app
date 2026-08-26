import { describe, expect, it } from "vitest";
import { buildMotionRenderCommand } from "@/features/video-rendering/motion-command";
import type { MotionVideoPlan } from "@/lib/api/client";

const plan: MotionVideoPlan = {
  version: 1,
  durationSeconds: 15,
  voiceScript: "Một video từ ảnh.",
  scenes: [
    { assetIndex: 0, outputStartSeconds: 0, outputEndSeconds: 7.5, motion: "zoom-in", purpose: "hook" },
    { assetIndex: 1, outputStartSeconds: 7.5, outputEndSeconds: 15, motion: "pan-right", purpose: "detail" },
  ],
  subtitles: [],
  overlays: [],
};

describe("buildMotionRenderCommand", () => {
  it("creates looping image inputs and browser-compatible audio/video", () => {
    const command = buildMotionRenderCommand({ assetPaths: ["a.jpg", "b.png"], voicePath: "voice.mp3", plan });
    expect(command.filter((value) => value === "-loop")).toHaveLength(2);
    expect(command).toContain("a.jpg");
    expect(command).toContain("b.png");
    expect(option(command, "-map", 1)).toBe("2:a:0");
    expect(option(command, "-pix_fmt")).toBe("yuv420p");
    expect(option(command, "-c:a")).toBe("aac");
    expect(option(command, "-movflags")).toBe("+faststart");
    expect(option(command, "-filter_complex")).toContain("zoompan");
  });
});

function option(command: string[], name: string, occurrence = 0): string {
  let index = -1;
  for (let count = 0; count <= occurrence; count++) index = command.indexOf(name, index + 1);
  if (index < 0 || !command[index + 1]) throw new Error(`Missing ${name}`);
  return command[index + 1];
}
