import type { components } from "@/lib/api/schema";

export type VideoPlan = components["schemas"]["VideoPlan"];

export function validateEditPlan(plan: VideoPlan, requestedDuration: number, sourceDuration: number): string[] {
  const errors: string[] = [];
  if (plan.version !== 1) errors.push("Phiên bản edit plan không được hỗ trợ.");
  if (plan.durationSeconds <= 0 || plan.durationSeconds > requestedDuration) errors.push("Thời lượng edit plan không hợp lệ.");
  let lastOutputEnd = 0;
  for (const scene of plan.scenes) {
    if (scene.sourceStartSeconds < 0 || scene.sourceEndSeconds <= scene.sourceStartSeconds || scene.sourceEndSeconds > sourceDuration) errors.push("Timestamp nguồn không hợp lệ.");
    if (scene.outputStartSeconds < lastOutputEnd || scene.outputEndSeconds <= scene.outputStartSeconds || scene.outputEndSeconds > requestedDuration) errors.push("Các cảnh bị chồng lấn hoặc vượt thời lượng.");
    lastOutputEnd = scene.outputEndSeconds;
  }
  for (const subtitle of plan.subtitles) {
    if (subtitle.startSeconds < 0 || subtitle.endSeconds <= subtitle.startSeconds || subtitle.endSeconds > requestedDuration) errors.push("Timestamp phụ đề không hợp lệ.");
  }
  return [...new Set(errors)];
}

