import { describe, expect, it } from "vitest";
import { pruneDailyStats, summaryBand, todayTodoCounts } from "./summary-service";
import type { Todo } from "./todo-service";

describe("today summary helpers", () => {
  it("keeps only the newest 30 calendar days", () => {
    const stats = Object.fromEntries(Array.from({ length: 32 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 9, 8 - index));
      return [
        date.toISOString().slice(0, 10),
        { standUps: index, waterCups: 0, missed: 0 },
      ];
    }));
    const kept = pruneDailyStats(stats, "2026-10-08");
    expect(Object.keys(kept)).toHaveLength(30);
    expect(kept["2026-09-07"]).toBeUndefined();
  });

  it("counts today's completed and total tasks, then selects a completion band", () => {
    const todos: Todo[] = [
      { id: "a", text: "a", scheduledDate: "2026-10-08", deadline: null, reminderAt: null, category: "other", priority: "normal", repeat: { kind: "once" }, sortOrder: 1, createdAt: 1, completedAt: new Date("2026-10-08T12:00:00").getTime() },
      { id: "b", text: "b", scheduledDate: "2026-10-08", deadline: null, reminderAt: null, category: "other", priority: "normal", repeat: { kind: "once" }, sortOrder: 2, createdAt: 1, completedAt: null },
    ];
    expect(todayTodoCounts(todos, "2026-10-08")).toEqual({ completed: 1, total: 2 });
    expect(summaryBand({ completed: 0, total: 3 })).toBe("low");
    expect(summaryBand({ completed: 2, total: 3 })).toBe("mid");
    expect(summaryBand({ completed: 3, total: 3 })).toBe("high");
  });
});
