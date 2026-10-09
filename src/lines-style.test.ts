import { describe, expect, it } from "vitest";
import { abstractLines } from "./lines-abstract";
import { lines, SCENE_KEYS } from "./lines";
import { LINES_DEFAULT, pickLine, MAX_LINE_LEN } from "./lines-service";

describe("抽象风格台词", () => {
  it("每个场景都有抽象台词，单条不超过 30 字，不含不当字眼", () => {
    for (const scene of SCENE_KEYS) {
      expect(abstractLines[scene].length).toBeGreaterThan(0);
      for (const text of abstractLines[scene]) {
        expect(text.length).toBeLessThanOrEqual(MAX_LINE_LEN);
        expect(text).not.toMatch(/摸鱼|领导请/);
      }
    }
  });
  it("默认只抽正常台词；选抽象只抽抽象；混合两边都有", () => {
    const base = { ...LINES_DEFAULT, mode: "builtin_only" as const };
    const seen = (style?: "normal" | "abstract" | "mix") => {
      const set = new Set<string>();
      for (let i = 0; i < 600; i += 1) set.add(pickLine({ ...base, style }, "general", { rng: () => (i + 0.5) / 600 }).text);
      return set;
    };
    const normal = seen(); const abstract = seen("abstract"); const mix = seen("mix");
    expect([...normal].every(t => lines.general.includes(t))).toBe(true);
    expect([...abstract].every(t => abstractLines.general.includes(t))).toBe(true);
    expect([...mix].some(t => lines.general.includes(t))).toBe(true);
    expect([...mix].some(t => abstractLines.general.includes(t))).toBe(true);
  });
});
