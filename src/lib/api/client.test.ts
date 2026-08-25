import { describe, expect, it } from "vitest";
import { ApiError, createApiClient, parseErrorResponse } from "./client";

describe("API error handling", () => {
  it("keeps the backend request ID", async () => {
    const response = new Response(JSON.stringify({ error: { code: "invalid_request", message: "Sai dữ liệu", requestId: "req-123" } }), { status: 400, headers: { "Content-Type": "application/json" } });
    const error = await parseErrorResponse(response);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.requestId).toBe("req-123");
    expect(error.message).toBe("Sai dữ liệu");
  });
  it("falls back for non-JSON proxy failures", async () => {
    const error = await parseErrorResponse(new Response("Bad Gateway", { status: 502 }));
    expect(error.message).toMatch(/502/);
  });
});

describe("API request transport", () => {
  it("calls the product enrichment endpoint", async () => {
    let requestedURL = "";
    const fetcher: typeof fetch = async (input) => {
      requestedURL = String(input);
      return new Response(JSON.stringify({ productUrl: "https://shop.example/p/1", productName: "Demo", brand: "", features: [], imageUrl: "", sources: ["open-graph"], warnings: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const result = await createApiClient("https://api.example.com/", fetcher).enrichProduct({ productUrl: "https://shop.example/p/1" });

    expect(requestedURL).toBe("https://api.example.com/api/v1/products/enrich");
    expect(result.productName).toBe("Demo");
  });

  it("removes trailing slashes from the API base URL", async () => {
    let requestedURL = "";
    const fetcher: typeof fetch = async (input) => {
      requestedURL = String(input);
      return new Response(JSON.stringify({ hooks: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    await createApiClient("https://api.example.com///", fetcher).generateHooks({
      productName: "Demo",
      brand: "",
      analysis: { summary: "Demo", targetAudience: [], useCases: [], verifiedFacts: [], userProvidedClaims: [], warnings: [], relevantScenes: [] },
    });
    expect(requestedURL).toBe("https://api.example.com/api/v1/hooks/generate");
  });

  it("rejects an oversized JSON request before sending it", async () => {
    let called = false;
    const fetcher: typeof fetch = async () => {
      called = true;
      return new Response("{}", { status: 200 });
    };
    const request = createApiClient("https://api.example.com", fetcher).analyzeProduct({
      productName: "Demo",
      brand: "",
      productUrl: "",
      features: [],
      frames: [{ timestampSeconds: 1, mimeType: "image/webp", dataBase64: "a".repeat(3_500_000) }],
    });
    await expect(request).rejects.toMatchObject({ status: 413, code: "request_too_large" });
    expect(called).toBe(false);
  });

  it("accepts an audio response from the voice endpoint", async () => {
    const fetcher: typeof fetch = async () => new Response(new Uint8Array(2_000), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });

    const voice = await createApiClient("https://api.example.com", fetcher).generateVoice({
      text: "Xin chào",
      voice: "coral",
      style: "Tự nhiên",
      targetDurationSeconds: 15,
    });

    expect(voice.type).toBe("audio/mpeg");
    expect(voice.size).toBe(2_000);
  });

  it("rejects a successful non-audio voice response", async () => {
    const fetcher: typeof fetch = async () => new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const request = createApiClient("https://api.example.com", fetcher).generateVoice({
      text: "Xin chào",
      voice: "coral",
      style: "Tự nhiên",
      targetDurationSeconds: 15,
    });

    await expect(request).rejects.toMatchObject({ status: 502, code: "invalid_voice_response" });
  });
});
