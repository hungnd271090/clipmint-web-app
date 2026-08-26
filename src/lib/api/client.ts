import type { components } from "./schema";

export type ProductAnalyzeRequest = components["schemas"]["ProductAnalyzeRequest"];
export type ProductAnalysis = components["schemas"]["ProductAnalysis"];
export type ProductEnrichRequest = components["schemas"]["ProductEnrichRequest"];
export type ProductEnrichResponse = components["schemas"]["ProductEnrichResponse"];
export type HookGenerateRequest = components["schemas"]["HookGenerateRequest"];
export type HookGenerateResponse = components["schemas"]["HookGenerateResponse"];
export type Hook = components["schemas"]["Hook"];
export type VideoPlanGenerateRequest = components["schemas"]["VideoPlanGenerateRequest"];
export type VideoPlan = components["schemas"]["VideoPlan"];
export type MotionVideoPlanGenerateRequest = components["schemas"]["MotionVideoPlanGenerateRequest"];
export type MotionVideoPlan = components["schemas"]["MotionVideoPlan"];
export type VoiceGenerateRequest = components["schemas"]["VoiceGenerateRequest"];

type ErrorEnvelope = { error?: { code?: string; message?: string; requestId?: string } };
const MAX_JSON_REQUEST_BYTES = 3_500_000;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = "api_error",
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function parseErrorResponse(response: Response): Promise<ApiError> {
  let body: ErrorEnvelope = {};
  try {
    body = (await response.json()) as ErrorEnvelope;
  } catch {
    // The stable fallback below is used for proxy and non-JSON failures.
  }
  return new ApiError(body.error?.message ?? `Yêu cầu thất bại (${response.status}).`, response.status, body.error?.code, body.error?.requestId);
}

export function createApiClient(
  baseURL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080",
  fetcher: typeof fetch = fetch,
) {
  const normalizedBaseURL = baseURL.replace(/\/+$/, "");

  async function json<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const payload = JSON.stringify(body);
    if (new TextEncoder().encode(payload).byteLength > MAX_JSON_REQUEST_BYTES) {
      throw new ApiError("Dữ liệu hình ảnh quá lớn. Hãy chọn video có độ phân giải thấp hơn.", 413, "request_too_large");
    }
    const response = await fetcher(`${normalizedBaseURL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: payload,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(65_000)]) : AbortSignal.timeout(65_000),
    });
    if (!response.ok) throw await parseErrorResponse(response);
    return response.json() as Promise<T>;
  }

  return {
    enrichProduct: (body: ProductEnrichRequest, signal?: AbortSignal) => json<ProductEnrichResponse>("/api/v1/products/enrich", body, signal),
    analyzeProduct: (body: ProductAnalyzeRequest) => json<ProductAnalysis>("/api/v1/products/analyze", body),
    generateHooks: (body: HookGenerateRequest) => json<HookGenerateResponse>("/api/v1/hooks/generate", body),
    generateVideoPlan: (body: VideoPlanGenerateRequest) => json<VideoPlan>("/api/v1/video-plans/generate", body),
    generateMotionVideoPlan: (body: MotionVideoPlanGenerateRequest) => json<MotionVideoPlan>("/api/v1/motion-video-plans/generate", body),
    productImageURL: (remoteURL: string) => `${normalizedBaseURL}/api/v1/assets/image?url=${encodeURIComponent(remoteURL)}`,
    fetchProductImage: async (remoteURL: string) => {
      const response = await fetcher(`${normalizedBaseURL}/api/v1/assets/image?url=${encodeURIComponent(remoteURL)}`, {
        headers: { Accept: "image/jpeg,image/png,image/webp" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw await parseErrorResponse(response);
      const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
      if (!contentType.startsWith("image/")) throw new ApiError("API không trả về ảnh hợp lệ.", 502, "invalid_image_response");
      return response.blob();
    },
    generateVoice: async (body: VoiceGenerateRequest) => {
      const response = await fetcher(`${normalizedBaseURL}/api/v1/voices/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "audio/mpeg,audio/wav" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(65_000),
      });
      if (!response.ok) throw await parseErrorResponse(response);
      const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
      if (!contentType.startsWith("audio/")) {
        throw new ApiError("API giọng đọc không trả về dữ liệu audio hợp lệ.", 502, "invalid_voice_response");
      }
      return response.blob();
    },
  };
}

export const api = createApiClient();
