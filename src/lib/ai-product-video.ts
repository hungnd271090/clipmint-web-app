import type { AIVideoJob, MotionVideoPlan, ProductAnalysis, VideoPlan } from "@/lib/api/client";

type PollOptions = {
  intervalMs?: number;
  timeoutMs?: number;
  onUpdate?: (job: AIVideoJob) => void;
};

export async function waitForAIVideoJob(
  id: string,
  getJob: (id: string) => Promise<AIVideoJob>,
  options: PollOptions = {},
): Promise<AIVideoJob> {
  const intervalMs = options.intervalMs ?? 5_000;
  const deadline = Date.now() + (options.timeoutMs ?? 8 * 60_000);
  while (Date.now() < deadline) {
    const job = await getJob(id);
    options.onUpdate?.(job);
    if (job.status === "succeeded") {
      if (!job.outputUrls.length) throw new Error("AI đã hoàn tất nhưng không trả về video.");
      return job;
    }
    if (job.status === "failed") throw new Error(job.failure || "AI Product Video không thể hoàn tất.");
    await delay(intervalMs);
  }
  throw new Error("AI Product Video mất quá nhiều thời gian. Bạn có thể thử lại sau.");
}

export function buildProductInfo(productName: string, analysis: ProductAnalysis): string {
  const facts = [...analysis.verifiedFacts, ...analysis.userProvidedClaims, ...analysis.useCases]
    .map((value) => value.trim()).filter(Boolean);
  return [`Tên sản phẩm: ${productName.trim()}`, analysis.summary.trim(), ...facts].filter(Boolean).join("\n").slice(0, 2500);
}

export function buildProductConcept(plan: MotionVideoPlan): string {
  const visualSequence = plan.scenes.map((scene, index) => `Cảnh ${index + 1}: ảnh ${scene.assetIndex + 1}, mục đích ${scene.purpose}`).join("; ");
  return [
    "Tạo video quảng cáo sản phẩm dọc, nhịp nhanh, hình ảnh chân thực và cao cấp.",
    "Giữ đúng thiết kế, màu sắc và chi tiết sản phẩm trong ảnh tham chiếu; không tự thêm logo, chữ hoặc tính năng.",
    "Chỉ quay sản phẩm trong bối cảnh phù hợp, không tạo người hoặc khuôn mặt.",
    `Thông điệp bán hàng: ${plan.voiceScript}`,
    visualSequence,
  ].join("\n").slice(0, 3500);
}

export function motionPlanForGeneratedVideo(plan: MotionVideoPlan, sourceDuration: number): VideoPlan {
  const duration = Math.min(plan.durationSeconds, sourceDuration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Video AI có thời lượng không hợp lệ.");
  return {
    version: 1,
    durationSeconds: duration,
    voiceScript: plan.voiceScript,
    scenes: [{ sourceStartSeconds: 0, sourceEndSeconds: duration, outputStartSeconds: 0, outputEndSeconds: duration, purpose: "ai-product-video" }],
    subtitles: plan.subtitles.filter((item) => item.startSeconds < duration).map((item) => ({ ...item, endSeconds: Math.min(item.endSeconds, duration) })).filter((item) => item.endSeconds > item.startSeconds),
    overlays: plan.overlays.filter((item) => item.startSeconds < duration).map((item) => ({ ...item, endSeconds: Math.min(item.endSeconds, duration) })).filter((item) => item.endSeconds > item.startSeconds),
  };
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
