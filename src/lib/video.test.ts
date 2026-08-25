import { describe, expect, it } from "vitest";
import { metadataWarnings, validateVideoFile } from "./video";

describe("validateVideoFile", () => {
  it("accepts an MP4 within the MVP limit", () => {
    expect(validateVideoFile({ name: "demo.mp4", size: 20_000_000, type: "video/mp4" })).toEqual([]);
  });
  it("rejects unsupported and oversized files", () => {
    expect(validateVideoFile({ name: "demo.avi", size: 10, type: "video/avi" })[0]).toMatch(/MP4/);
    expect(validateVideoFile({ name: "demo.mov", size: 301 * 1024 * 1024, type: "video/quicktime" })[0]).toMatch(/300 MB/);
  });
  it("warns about landscape 4K input", () => {
    expect(metadataWarnings(60, 3840, 2160)).toHaveLength(2);
  });
});

