import { describe, expect, it } from "vitest";
import { createStressState, hitStress, stressExpired, stressFrame, stressScale, validateStressPhoto } from "./stress-state";

describe("stress state", () => {
  it("advances frames, shrinks, and ends at 25 hits", () => {
    let state = createStressState(0);
    state = hitStress(state); expect(stressFrame(state.hits)).toBe(2);
    for (let i = 0; i < 14; i += 1) state = hitStress(state);
    expect(stressFrame(state.hits)).toBe(4); expect(stressScale(state.hits)).toBe(.55);
    for (let i = state.hits; i < 25; i += 1) state = hitStress(state);
    expect(state.ended).toBe(true); expect(stressFrame(state.hits)).toBe(5);
  });
  it("ends after thirty seconds", () => expect(stressExpired(createStressState(10), 30_010)).toBe(true));
  it("only accepts small supported images", () => {
    expect(validateStressPhoto({ type: "image/jpeg", size: 5 * 1024 * 1024 })).toBeNull();
    expect(validateStressPhoto({ type: "image/gif", size: 1 })).toContain("PNG");
    expect(validateStressPhoto({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toContain("5MB");
  });
});
