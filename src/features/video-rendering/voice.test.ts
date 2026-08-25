import { describe, expect, it } from "vitest";
import { assertVoiceBlob } from "@/features/video-rendering/voice";

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
});
