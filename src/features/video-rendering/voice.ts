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

export async function assertAudibleVoiceBlob(voice: Blob): Promise<void> {
  assertVoiceBlob(voice);

  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(await voice.arrayBuffer());
    const channels = Array.from(
      { length: decoded.numberOfChannels },
      (_, channel) => decoded.getChannelData(channel),
    );
    if (!hasAudibleSamples(channels)) {
      throw new Error("Giọng đọc AI hoàn toàn im lặng. Hãy kiểm tra OPENAI_API_KEY trên backend production.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("hoàn toàn im lặng")) throw error;
    throw new Error("Không thể giải mã dữ liệu giọng đọc AI. Hãy kiểm tra TTS backend.");
  } finally {
    await audioContext.close();
  }
}

export function hasAudibleSamples(channels: Float32Array[], threshold = 0.0001): boolean {
  for (const samples of channels) {
    for (let index = 0; index < samples.length; index += 32) {
      if (Math.abs(samples[index]) >= threshold) return true;
    }
  }
  return false;
}
