import type { ReminderStats } from "./reminder-engine";
import type { Todo } from "./todo-service";

export type SummaryBand = "low" | "mid" | "high";

function dayOffset(today: string, candidate: string): number {
  const base = new Date(today + "T00:00:00");
  const value = new Date(candidate + "T00:00:00");
  return Math.round((base.getTime() - value.getTime()) / 86400000);
}

export function pruneDailyStats<T>(stats: Record<string, T>, today: string): Record<string, T> {
  return Object.fromEntries(Object.entries(stats).filter(([date]) => {
    const offset = dayOffset(today, date);
    return offset >= 0 && offset < 30;
  }));
}

export function todayTodoCounts(todos: Todo[], today: string): { completed: number; total: number } {
  const todayStart = new Date(today + "T00:00:00").getTime();
  const tomorrowStart = todayStart + 86400000;
  const todayTodos = todos.filter(todo => todo.scheduledDate === today);
  return {
    total: todayTodos.length,
    completed: todos.filter(todo => todo.completedAt !== null && todo.completedAt >= todayStart && todo.completedAt < tomorrowStart).length,
  };
}

export function summaryBand(counts: { completed: number; total: number }): SummaryBand {
  if (counts.total > 0 && counts.completed >= counts.total) return "high";
  if (counts.completed > 0 || counts.total === 0) return "mid";
  return "low";
}

export function emptyReminderStats(): ReminderStats {
  return { standUps: 0, waterCups: 0, eyeBreaks: 0, exercises: 0, focusSessions: 0, missed: 0 };
}
