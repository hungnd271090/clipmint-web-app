import { describe, expect, it } from "vitest";
import { toggleHookSelection, validateVideoConfiguration } from "./hooks";

describe("hook selection", () => {
  it("never selects more than three hooks", () => {
    expect(toggleHookSelection(["1", "2", "3"], "4")).toEqual(["1", "2", "3"]);
  });
  it("removes a selected hook", () => {
    expect(toggleHookSelection(["1", "2"], "1")).toEqual(["2"]);
  });
  it("requires one hook per requested video", () => {
    expect(validateVideoConfiguration(1, 2)).toMatch(/đúng 2 hook/);
    expect(validateVideoConfiguration(2, 2)).toBeNull();
  });
});

