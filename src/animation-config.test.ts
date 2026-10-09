import { describe, expect, it } from "vitest";
import { baseAnimationPlan, randomDelay } from "./animation-config";

function at(day: number, hour: number, minute = 0) {
  return new Date(2026, 9, day, hour, minute);
}

describe("base animation configuration", () => {
  it("selects periodic states and preserves Friday priority", () => {
    expect(baseAnimationPlan(at(8, 8, 30), false).key).toBe("morning");
    expect(baseAnimationPlan(at(8, 11, 20), false).key).toBe("lunch");
    expect(baseAnimationPlan(at(8, 14, 30), false).key).toBe("afternoon");
    expect(baseAnimationPlan(at(9, 17, 30), false).key).toBe("friday");
    expect(baseAnimationPlan(at(8, 17, 30), false).key).toBe("offwork");
  });

  it("keeps meeting mode static and bounds randomized delays", () => {
    expect(baseAnimationPlan(at(8, 8, 30), true)).toMatchObject({ id: "mood-06", animated: false });
    expect(randomDelay([3000, 6000], () => 0)).toBe(3000);
    expect(randomDelay([3000, 6000], () => 0.5)).toBe(4500);
  });
});
