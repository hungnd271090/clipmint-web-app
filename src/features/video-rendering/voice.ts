const MIN_VOICE_BYTES = 512;

export function assertVoiceBlob(voice: Blob): void {
  if (voice.size < MIN_VOICE_BYTES) {
    throw new Error("Dữ liệu giọng đọc AI rỗng hoặc không hợp lệ. Hãy tạo lại voice.");
  }

  const contentType = voice.type.toLowerCase().split(";", 1)[0];
  if (contentType && !contentType.startsWith("audio/")) {
    throw new Error(`API giọng đọc trả về sai định dạng (${contentType}).`);
  }
}
