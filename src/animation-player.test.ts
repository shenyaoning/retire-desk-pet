import { describe, expect, it } from "vitest";
import {
  AnimationPlayback,
  frameDuration,
  frameTransform,
  sampleTimeline,
  type AnimationSpec,
} from "./animation-player";

const spec = (overrides: Partial<AnimationSpec> = {}): AnimationSpec => ({
  frames: ["f01.png", "f02.png", "f03.png"],
  order: [1, 1, 2, 3],
  dur_ms: 100,
  dur_by_frame_ms: {},
  lift_px_of_240: [],
  squash: [],
  canvas: 512,
  anchor: "bottom-center",
  effects: {},
  ...overrides,
});

describe("animation timeline", () => {
  it("follows the configured order, including repeated hold frames", () => {
    expect(sampleTimeline(spec(), 0, "loop")).toMatchObject({ sequenceIndex: 0, frameNumber: 1 });
    expect(sampleTimeline(spec(), 99, "loop")).toMatchObject({ sequenceIndex: 0, frameNumber: 1 });
    expect(sampleTimeline(spec(), 100, "loop")).toMatchObject({ sequenceIndex: 1, frameNumber: 1 });
    expect(sampleTimeline(spec(), 200, "loop")).toMatchObject({ sequenceIndex: 2, frameNumber: 2 });
    expect(sampleTimeline(spec(), 400, "loop")).toMatchObject({ sequenceIndex: 0, frameNumber: 1 });
  });

  it("uses per-frame durations and falls back to dur_ms", () => {
    const animation = spec({ dur_by_frame_ms: { "1": 250, "3": 50 } });
    expect(frameDuration(animation, 1)).toBe(250);
    expect(frameDuration(animation, 2)).toBe(100);
    expect(frameDuration(animation, 3)).toBe(50);
    expect(sampleTimeline(animation, 499, "once")).toMatchObject({ sequenceIndex: 1, frameNumber: 1, done: false });
    expect(sampleTimeline(animation, 500, "once")).toMatchObject({ sequenceIndex: 2, frameNumber: 2, done: false });
    expect(sampleTimeline(animation, 650, "once")).toMatchObject({ sequenceIndex: 3, frameNumber: 3, done: true });
  });

  it("applies configured lift, shake, pulse, sway, and sigh from the play sequence", () => {
    const animation = spec({
      order: [1, 2, 3, 2],
      lift_px_of_240: [0, 24, 0],
      effects: { shake_px_of_240: 3, pulse: 0.04, sway_deg: 2, sigh: 0.05 },
    });
    const transformed = frameTransform(animation, 1, 120);
    expect(transformed.lift).toBe(12);
    expect(transformed.translateX).toBe(-1.5);
    expect(transformed.rotate).toBeCloseTo(2);
    expect(transformed.scaleX).toBeGreaterThan(1);
    expect(transformed.scaleY).toBeLessThan(transformed.scaleX);
  });
});

describe("animation playback", () => {
  it("interrupts the current animation immediately", () => {
    const playback = new AnimationPlayback();
    playback.play("mood-01", spec(), "loop", 0);
    expect(playback.sample(220)).toMatchObject({ id: "mood-01", frameNumber: 2 });
    playback.play("mood-09", spec({ order: [3, 2, 1] }), "once", 225);
    expect(playback.sample(225)).toMatchObject({ id: "mood-09", frameNumber: 3, sequenceIndex: 0 });
  });

  it("falls back to the static sticker when animation data is missing", () => {
    const playback = new AnimationPlayback();
    playback.play("mood-04", null, "loop", 0);
    expect(playback.sample(20)).toEqual({ kind: "static", id: "mood-04" });
  });
});
