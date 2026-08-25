import { describe, expect, it } from "vitest";
import { MAX_FRAME_COUNT, representativeTimestamps } from "./extract";

describe("representativeTimestamps", () => {
  it("uses at least four evenly distributed frames", () => {
    expect(representativeTimestamps(10)).toEqual([1.25, 3.75, 6.25, 8.75]);
  });

  it("never exceeds the Vercel-safe frame count", () => {
    const timestamps = representativeTimestamps(300);
    expect(timestamps).toHaveLength(MAX_FRAME_COUNT);
    expect(timestamps[0]).toBeGreaterThan(0);
    expect(timestamps.at(-1)).toBeLessThan(300);
  });
});
