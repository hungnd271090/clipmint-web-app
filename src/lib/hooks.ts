export function toggleHookSelection(current: string[], id: string, maximum = 3): string[] {
  if (current.includes(id)) return current.filter((item) => item !== id);
  if (current.length >= maximum) return current;
  return [...current, id];
}

export function validateVideoConfiguration(selectedCount: number, requestedCount: number): string | null {
  if (requestedCount < 1 || requestedCount > 3) return "Số lượng video phải từ 1 đến 3.";
  if (selectedCount !== requestedCount) return `Hãy chọn đúng ${requestedCount} hook để tạo ${requestedCount} video.`;
  return null;
}

