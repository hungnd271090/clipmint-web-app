import { describe, expect, it } from "vitest";
import { outputFilename } from "./filename";

describe("output filename", () => {
  it("creates a safe deterministic Vietnamese filename", () => {
    expect(outputFilename("Máy hút bụi Mini M1", 1)).toBe("clipmint-may-hut-bui-mini-m1-02.mp4");
  });
  it("uses a fallback for symbols", () => expect(outputFilename("🔥", 0)).toBe("clipmint-san-pham-01.mp4"));
});

