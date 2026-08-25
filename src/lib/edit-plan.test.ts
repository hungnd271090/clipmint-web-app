import { describe, expect, it } from "vitest";
import { validateEditPlan, type VideoPlan } from "./edit-plan";

const valid: VideoPlan = {
  version: 1, durationSeconds: 15, voiceScript: "Demo",
  scenes: [{ sourceStartSeconds: 0, sourceEndSeconds: 5, outputStartSeconds: 0, outputEndSeconds: 5, purpose: "hook" }],
  subtitles: [{ text: "Demo", startSeconds: 0, endSeconds: 3, highlightWords: [] }], overlays: [],
};

describe("edit plan validation", () => {
  it("accepts a safe plan", () => expect(validateEditPlan(valid, 15, 30)).toEqual([]));
  it("rejects overlapping output scenes", () => {
    const plan = { ...valid, scenes: [...valid.scenes, { sourceStartSeconds: 5, sourceEndSeconds: 8, outputStartSeconds: 4, outputEndSeconds: 7, purpose: "demo" }] };
    expect(validateEditPlan(plan, 15, 30).join(" ")).toMatch(/chồng lấn/);
  });
  it("rejects source timestamps outside the video", () => {
    const plan = { ...valid, scenes: [{ ...valid.scenes[0], sourceEndSeconds: 40 }] };
    expect(validateEditPlan(plan, 15, 30).join(" ")).toMatch(/nguồn/);
  });
});

