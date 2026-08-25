import { describe, expect, it } from "vitest";
import { assertVoiceBlob, hasAudibleSamples } from "@/features/video-rendering/voice";

describe("assertVoiceBlob", () => {
  it("accepts a non-empty audio response", () => {
    expect(() => assertVoiceBlob(new Blob([new Uint8Array(2_000)], { type: "audio/mpeg" }))).not.toThrow();
  });

  it("rejects an empty audio response", () => {
    expect(() => assertVoiceBlob(new Blob([], { type: "audio/mpeg" }))).toThrow("rỗng hoặc không hợp lệ");
  });

  it("rejects a non-audio response", () => {
    expect(() => assertVoiceBlob(new Blob([new Uint8Array(2_000)], { type: "application/json" }))).toThrow("sai định dạng");
  });

  it("detects an entirely silent decoded audio buffer", () => {
    expect(hasAudibleSamples([new Float32Array(4_096)])).toBe(false);
  });

  it("detects audible samples above the noise floor", () => {
    const samples = new Float32Array(4_096);
    samples[64] = 0.02;
    expect(hasAudibleSamples([samples])).toBe(true);
  });
});
