import { describe, expect, it, vi } from "vitest";
import { buildProductConcept, motionPlanForGeneratedVideo, waitForAIVideoJob } from "./ai-product-video";
import type { MotionVideoPlan } from "@/lib/api/client";

const plan: MotionVideoPlan = {
  version: 1, durationSeconds: 15, voiceScript: "Đây là sản phẩm tiện lợi.",
  scenes: [{ assetIndex: 0, outputStartSeconds: 0, outputEndSeconds: 15, motion: "depth-zoom", purpose: "showcase" }],
  subtitles: [{ text: "Sản phẩm tiện lợi", startSeconds: 0, endSeconds: 4, highlightWords: [] }],
  overlays: [{ text: "Tiện lợi", startSeconds: 1, endSeconds: 5, position: "top" }],
};

describe("AI product video helpers", () => {
  it("polls until a completed output is available", async () => {
    const getJob = vi.fn()
      .mockResolvedValueOnce({ id: "job", status: "running", outputUrls: [] })
      .mockResolvedValueOnce({ id: "job", status: "succeeded", outputUrls: ["https://cdn.example/video.mp4"] });
    const result = await waitForAIVideoJob("job", getJob, { intervalMs: 0, timeoutMs: 1000 });
    expect(result.outputUrls[0]).toContain("video.mp4");
    expect(getJob).toHaveBeenCalledTimes(2);
  });

  it("keeps the generated source and narration aligned", () => {
    const converted = motionPlanForGeneratedVideo(plan, 12.5);
    expect(converted.durationSeconds).toBe(12.5);
    expect(converted.scenes[0].sourceEndSeconds).toBe(12.5);
    expect(buildProductConcept(plan)).toContain("không tạo người hoặc khuôn mặt");
  });
});
