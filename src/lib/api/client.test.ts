import { describe, expect, it } from "vitest";
import { ApiError, parseErrorResponse } from "./client";

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

