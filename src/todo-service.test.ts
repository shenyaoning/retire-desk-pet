import { describe, expect, it } from "vitest";
import {
  MAX_TODOS,
  completeTodo,
  importTodos,
  moveOverdueToToday,
  nextOccurrence,
  openTodosToday,
  sortTodos,
  validateTodo,
  type Todo,
} from "./todo-service";

const todo = (overrides: Partial<Todo> = {}): Todo => ({
  id: "t1",
  text: "准备材料",
  scheduledDate: "2026-10-08",
  deadline: null,
  reminderAt: null,
  category: "material",
  priority: "normal",
  repeat: { kind: "once" },
  sortOrder: 1,
  createdAt: 1,
  completedAt: null,
  ...overrides,
});

describe("todo recurrence", () => {
  it("creates the next daily, weekly, monthly, and workday occurrence on completion", () => {
    expect(nextOccurrence(todo({ repeat: { kind: "daily" } }), "2026-10-08", () => true)).toBe("2026-10-09");
    expect(nextOccurrence(todo({ repeat: { kind: "weekly", weekday: 1 } }), "2026-10-08", () => true)).toBe("2026-10-12");
    expect(nextOccurrence(todo({ scheduledDate: "2026-01-31", repeat: { kind: "monthly", day: 31 } }), "2026-01-31", () => true)).toBe("2026-02-28");
    expect(nextOccurrence(todo({ repeat: { kind: "monthly", day: 15 } }), "2026-03-03", () => true)).toBe("2026-03-15");
    expect(nextOccurrence(todo({ repeat: { kind: "workdays" } }), "2026-02-13", date => date !== "2026-02-14" && date !== "2026-02-15" && date !== "2026-02-16" && date !== "2026-02-17" && date !== "2026-02-18" && date !== "2026-02-19" && date !== "2026-02-20" && date !== "2026-02-21" && date !== "2026-02-22" && date !== "2026-02-23")).toBe("2026-02-24");
  });

  it("keeps a completed original and appends the next recurrence", () => {
    const result = completeTodo([todo({ repeat: { kind: "daily" } })], "t1", "2026-10-08", () => true, 100);
    expect(result.find(item => item.id === "t1")?.completedAt).toBe(100);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ scheduledDate: "2026-10-09", completedAt: null, repeat: { kind: "daily" } });
  });
});

describe("todo persistence rules", () => {
  it("moves overdue tasks to today and keeps explicit future tasks separate", () => {
    const list = [
      todo({ id: "old", scheduledDate: "2026-10-07", priority: "important" }),
      todo({ id: "future", scheduledDate: "2026-10-12" }),
    ];
    expect(moveOverdueToToday(list, ["old"], "2026-10-08")[0]).toMatchObject({ id: "old", scheduledDate: "2026-10-08" });
    expect(sortTodos(list, "2026-10-08").map(item => item.id)).toEqual(["old", "future"]);
  });

  it("rejects invalid import data and enforces text and total limits", () => {
    expect(validateTodo({ ...todo(), text: "x".repeat(41) })).toContain("40");
    expect(importTodos("not json", [])).toMatchObject({ report: { invalid: 1 } });
    expect(importTodos(JSON.stringify({ todos: [{ text: "missing fields" }] }), [])).toMatchObject({ report: { invalid: 1 } });
    const full = Array.from({ length: MAX_TODOS }, (_, index) => todo({ id: "old-" + index }));
    const imported = importTodos(JSON.stringify({ todos: [todo({ id: "new" })] }), full);
    expect(imported.todos).toHaveLength(MAX_TODOS);
    expect(imported.report.overLimit).toBe(1);
  });
});

describe("openTodosToday", () => {
  it("只含今天及逾期的未完成项，重要的在前，已完成和以后的不算", () => {
    const list = [
      todo({ id: "a", text: "今天普通", scheduledDate: "2026-10-09", sortOrder: 2 }),
      todo({ id: "b", text: "今天重要", scheduledDate: "2026-10-09", priority: "important", sortOrder: 3 }),
      todo({ id: "c", text: "逾期", scheduledDate: "2026-10-07", sortOrder: 1 }),
      todo({ id: "d", text: "已完成", scheduledDate: "2026-10-09", completedAt: 5 }),
      todo({ id: "e", text: "以后", scheduledDate: "2026-10-12" }),
    ];
    const ids = openTodosToday(list, "2026-10-09").map(item => item.id);
    expect(ids).toEqual(["b", "c", "a"]);
  });
});
