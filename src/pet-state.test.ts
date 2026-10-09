import { describe, expect, it } from "vitest";
import { recordClick, scheduledSticker, stickerWithReminderPriority } from "./pet-state";

function at(day: number, hour: number, minute = 0) {
  return new Date(2026, 9, day, hour, minute);
}

describe("sticker schedule", () => {
  it("uses half-open time windows and Friday priority", () => {
    expect(scheduledSticker(at(8, 8), false)).toBe("mood-03");
    expect(scheduledSticker(at(8, 9), false)).toBe("mood-01");
    expect(scheduledSticker(at(8, 11, 20), false)).toBe("mood-04");
    expect(scheduledSticker(at(9, 14, 30), false)).toBe("mood-08");
    expect(scheduledSticker(at(9, 14, 30), true)).toBe("mood-06");
  });
  it("recognizes five clicks in three seconds", () => {
    let clicks: number[] = [];
    for (let i = 0; i < 4; i++) clicks = recordClick(clicks, i * 600).clicks;
    expect(recordClick(clicks, 2400).angry).toBe(true);
    expect(recordClick(clicks, 6000).angry).toBe(false);
  });
  it("keeps the selected health sticker above drag and scheduled states while a reminder is pending", () => {
    expect(stickerWithReminderPriority("health-02", "mood-13", "mood-01")).toBe("health-02");
    expect(stickerWithReminderPriority(null, "mood-13", "mood-01")).toBe("mood-13");
  });
});
