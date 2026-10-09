import { invoke } from "@tauri-apps/api/core";
import { completeTodo, localDateKey, type Todo } from "./todo-service";
import { store } from "./store";
import { summaryBand, todayTodoCounts } from "./summary-service";
import { summaryText } from "./summary-texts";
import { hasPendingReminder, reminderMode } from "./reminder-center";

export interface TodoView {
  show(todo: Todo): void;
  hide(): void;
  showSummary(text: string): void;
}

type Environment = { bossHidden?: boolean; fullscreen?: boolean };
let view: TodoView | null = null;
let environment: Environment = {};
let activeId: string | null = null;
let timer: number | undefined;
let stressActive = false;

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function nowMinutes(now: Date): number { return now.getHours() * 60 + now.getMinutes(); }

function quiet(now: Date): boolean {
  const settings = store.settings;
  return !!environment.bossHidden || !!environment.fullscreen || settings.meetingMode ||
    nowMinutes(now) < minutes(settings.reminders.activeFrom) || nowMinutes(now) >= minutes(settings.offWork);
}

function dueTodo(now: number): Todo | null {
  return store.todos.find(todo => !todo.completedAt && todo.reminderAt !== null && todo.reminderAt <= now) ?? null;
}

function pump(now = new Date()): void {
  if (!view) return;
  const date = localDateKey(now);
  if (store.dailySummaryShown !== date && nowMinutes(now) >= minutes(store.settings.offWork)) {
    const counts = todayTodoCounts(store.todos, date);
    view.showSummary(summaryText(summaryBand(counts)));
    store.dailySummaryShown = date;
  }
  // 专注/午休期间不弹待办，计时结束后下一轮 pump 会补弹（reminderAt 已到期的仍在）
  if (stressActive || activeId || quiet(now) || hasPendingReminder() || reminderMode()) return;
  const todo = dueTodo(now.getTime());
  if (todo) {
    activeId = todo.id;
    view.show(todo);
  }
}

export function startTodoCenter(todoView: TodoView): void {
  view = todoView;
  window.clearInterval(timer);
  timer = window.setInterval(() => pump(), 15_000);
  pump();
}

export function updateTodoEnvironment(next: Environment): void {
  environment = { ...environment, ...next };
  pump();
}

export function todoReminderActive(): boolean { return activeId !== null; }

/** 悬停卡等处直接把某一条待办标记完成（重复待办按「工作日」规则排下一次） */
export async function completeTodoById(id: string): Promise<void> {
  const todo = store.todos.find(item => item.id === id);
  if (!todo || todo.completedAt) return;
  const now = Date.now();
  const isWorkday = (date: string) => invoke<boolean>("is_workday", { date }).catch(() => {
    const day = new Date(date + "T00:00:00").getDay();
    return day > 0 && day < 6;
  });
  let nextWorkday = "";
  if (todo.repeat.kind === "workdays") {
    let candidate = new Date(now + 86400000);
    for (let attempts = 0; attempts < 370; attempts += 1) {
      const key = localDateKey(candidate);
      if (await isWorkday(key)) { nextWorkday = key; break; }
      candidate = new Date(candidate.getTime() + 86400000);
    }
  }
  store.todos = completeTodo(store.todos, id, localDateKey(), date => date === nextWorkday, now);
  pump();
}

export async function respondToTodoReminder(action: "done" | "later" | "tomorrow"): Promise<void> {
  const id = activeId;
  if (!id) return;
  const todo = store.todos.find(item => item.id === id);
  activeId = null;
  view?.hide();
  if (!todo) return;
  const now = Date.now();
  if (action === "done") {
    const isWorkday = (date: string) => invoke<boolean>("is_workday", { date }).catch(() => {
      const day = new Date(date + "T00:00:00").getDay();
      return day > 0 && day < 6;
    });
    let nextWorkday = "";
    if (todo.repeat.kind === "workdays") {
      let candidate = new Date(now + 86400000);
      for (let attempts = 0; attempts < 370; attempts += 1) {
        const key = localDateKey(candidate);
        if (await isWorkday(key)) { nextWorkday = key; break; }
        candidate = new Date(candidate.getTime() + 86400000);
      }
    }
    store.todos = completeTodo(store.todos, id, localDateKey(), date => date === nextWorkday, now);
  } else if (action === "later") {
    store.todos = store.todos.map(item => item.id === id ? { ...item, reminderAt: now + 10 * 60_000 } : item);
  } else {
    const tomorrow = localDateKey(new Date(now + 86400000));
    store.todos = store.todos.map(item => item.id === id ? { ...item, scheduledDate: tomorrow, reminderAt: null } : item);
  }
  pump();
}

export function refreshTodoCenter(): void { pump(); }
export function setStressActive(active: boolean): void { stressActive = active; if (active) view?.hide(); if (!active) pump(); }
