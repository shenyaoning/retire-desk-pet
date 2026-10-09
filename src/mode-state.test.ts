import { describe, expect, it } from "vitest";
import { beginMode, recordAlarm, stopModeState, tickModeState } from "./mode-state";

describe("mode state", () => {
  const now = 1_000_000;
  it("rejects repeated starts and can stop", () => {
    const focus = beginMode(null, "focus", now, 25)!;
    expect(beginMode(focus, "lunch", now, 30)).toBeNull();
    expect(stopModeState(focus)).toBeNull();
  });
  it("moves focus to a break and ends the break", () => {
    const focus = beginMode(null, "focus", now, 25)!;
    const complete = tickModeState(focus, focus.endsAt);
    expect(complete.event).toBe("focus-complete");
    expect(complete.state?.kind).toBe("break");
    expect(tickModeState(complete.state, complete.state!.endsAt).event).toBe("break-complete");
  });
  it("ends lunch and limits the alarm to three", () => {
    const lunch = beginMode(null, "lunch", now, 30)!;
    expect(tickModeState(lunch, lunch.endsAt).event).toBe("lunch-complete");
    expect(recordAlarm(recordAlarm(recordAlarm(recordAlarm(lunch))))?.alarmCount).toBe(3);
  });
});
