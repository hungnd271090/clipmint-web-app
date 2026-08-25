import { describe, expect, it } from "vitest";
import { normalizedProductURL } from "./product-url";

describe("normalizedProductURL", () => {
  it("accepts HTTP product links", () => {
    expect(normalizedProductURL(" https://shop.example/product?id=1 ")).toBe("https://shop.example/product?id=1");
  });

  it("rejects non-web URLs and embedded credentials", () => {
    expect(normalizedProductURL("javascript:alert(1)")).toBeNull();
    expect(normalizedProductURL("https://user:pass@shop.example/product")).toBeNull();
  });
});
