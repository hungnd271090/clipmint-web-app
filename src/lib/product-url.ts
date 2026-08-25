export function normalizedProductURL(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
