export const MAX_TODOS = 500;

export type TodoCategory = "material" | "meeting" | "personal" | "other";
export type TodoPriority = "normal" | "important";
export type TodoRepeat =
  | { kind: "once" }
  | { kind: "daily" }
  | { kind: "weekly"; weekday: number }
  | { kind: "monthly"; day: number }
  | { kind: "workdays" };

export interface Todo {
  id: string;
  text: string;
  scheduledDate: string;
  deadline: string | null;
  reminderAt: number | null;
  category: TodoCategory;
  priority: TodoPriority;
  repeat: TodoRepeat;
  sortOrder: number;
  createdAt: number;
  completedAt: number | null;
}

export function localDateKey(now = new Date()): string {
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

export interface TodoImportReport {
  added: number;
  invalid: number;
  duplicate: number;
  overLimit: number;
}

const categories: TodoCategory[] = ["material", "meeting", "personal", "other"];
const priorities: TodoPriority[] = ["normal", "important"];
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function dateFrom(text: string): Date | null {
  if (!isoDate.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day ? value : null;
}

function toDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const value = dateFrom(date);
  if (!value) throw new Error("日期格式不正确");
  value.setUTCDate(value.getUTCDate() + days);
  return toDate(value);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isRepeat(value: unknown): value is TodoRepeat {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const repeat = value as TodoRepeat;
  if (["once", "daily", "workdays"].includes(repeat.kind)) return true;
  if (repeat.kind === "weekly") return Number.isInteger(repeat.weekday) && repeat.weekday >= 0 && repeat.weekday <= 6;
  return repeat.kind === "monthly" && Number.isInteger(repeat.day) && repeat.day >= 1 && repeat.day <= 31;
}

export function validateTodo(value: unknown): string | null {
  if (!value || typeof value !== "object") return "待办格式不正确";
  const todo = value as Partial<Todo>;
  if (typeof todo.id !== "string" || !todo.id) return "待办缺少编号";
  if (typeof todo.text !== "string" || !todo.text.trim()) return "待办内容不能为空";
  if (todo.text.trim().length > 40) return "待办内容最多 40 字";
  if (typeof todo.scheduledDate !== "string" || !dateFrom(todo.scheduledDate)) return "待办日期不正确";
  if (todo.deadline !== null && todo.deadline !== undefined && (typeof todo.deadline !== "string" || !dateFrom(todo.deadline))) return "截止日期不正确";
  if (todo.reminderAt !== null && todo.reminderAt !== undefined && (!Number.isFinite(todo.reminderAt) || todo.reminderAt <= 0)) return "提醒时间不正确";
  if (!categories.includes(todo.category as TodoCategory)) return "待办分类不正确";
  if (!priorities.includes(todo.priority as TodoPriority)) return "待办优先级不正确";
  if (!isRepeat(todo.repeat)) return "重复规则不正确";
  if (!Number.isFinite(todo.sortOrder) || !Number.isFinite(todo.createdAt)) return "待办排序信息不正确";
  if (todo.completedAt !== null && todo.completedAt !== undefined && !Number.isFinite(todo.completedAt)) return "完成时间不正确";
  return null;
}

export function createTodo(
  input: Pick<Todo, "text" | "scheduledDate" | "deadline" | "reminderAt" | "category" | "priority" | "repeat">,
  existing: Todo[],
  now = Date.now(),
): Todo {
  if (existing.length >= MAX_TODOS) throw new Error("待办最多 500 条，先删除一些吧");
  const item: Todo = {
    ...input,
    id: "todo-" + now + "-" + Math.random().toString(36).slice(2, 8),
    text: input.text.trim(),
    sortOrder: Math.max(0, ...existing.filter(todo => !todo.completedAt).map(todo => todo.sortOrder)) + 1,
    createdAt: now,
    completedAt: null,
  };
  const error = validateTodo(item);
  if (error) throw new Error(error);
  return item;
}

export function nextOccurrence(todo: Todo, fromDate: string, isWorkday: (date: string) => boolean): string | null {
  if (todo.repeat.kind === "once") return null;
  if (todo.repeat.kind === "daily") return addDays(fromDate, 1);
  if (todo.repeat.kind === "weekly") {
    const current = dateFrom(fromDate);
    if (!current) return null;
    const gap = (todo.repeat.weekday - current.getUTCDay() + 7) % 7 || 7;
    return addDays(fromDate, gap);
  }
  if (todo.repeat.kind === "monthly") {
    const current = dateFrom(fromDate);
    if (!current) return null;
    let year = current.getUTCFullYear();
    let month = current.getUTCMonth() + 1;
    if (Math.min(todo.repeat.day, daysInMonth(year, month)) <= current.getUTCDate()) {
      month += 1;
      if (month === 13) { year += 1; month = 1; }
    }
    const day = Math.min(todo.repeat.day, daysInMonth(year, month));
    return String(year) + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }
  let next = addDays(fromDate, 1);
  for (let attempts = 0; attempts < 370; attempts += 1) {
    if (isWorkday(next)) return next;
    next = addDays(next, 1);
  }
  return null;
}

export function completeTodo(
  todos: Todo[],
  id: string,
  today: string,
  isWorkday: (date: string) => boolean,
  now = Date.now(),
): Todo[] {
  const original = todos.find(todo => todo.id === id);
  if (!original || original.completedAt) return todos;
  const completed = todos.map(todo => todo.id === id ? { ...todo, completedAt: now } : todo);
  const nextDate = nextOccurrence(original, today, isWorkday);
  if (!nextDate || completed.length >= MAX_TODOS) return completed;
  const next: Todo = {
    ...original,
    id: "todo-" + now + "-" + Math.random().toString(36).slice(2, 8),
    scheduledDate: nextDate,
    reminderAt: null,
    sortOrder: Math.max(0, ...completed.filter(todo => !todo.completedAt).map(todo => todo.sortOrder)) + 1,
    createdAt: now,
    completedAt: null,
  };
  return [...completed, next];
}

export function moveOverdueToToday(todos: Todo[], ids: string[], today: string): Todo[] {
  const selected = new Set(ids);
  return todos.map(todo => selected.has(todo.id) && !todo.completedAt && todo.scheduledDate < today
    ? { ...todo, scheduledDate: today, reminderAt: null }
    : todo);
}

export function sortTodos(todos: Todo[], today: string): Todo[] {
  return [...todos].sort((left, right) => {
    const completed = Number(left.completedAt !== null) - Number(right.completedAt !== null);
    if (completed) return completed;
    const leftBucket = left.scheduledDate <= today ? 0 : 1;
    const rightBucket = right.scheduledDate <= today ? 0 : 1;
    if (leftBucket !== rightBucket) return leftBucket - rightBucket;
    if (left.priority !== right.priority) return left.priority === "important" ? -1 : 1;
    if (left.scheduledDate !== right.scheduledDate) return left.scheduledDate.localeCompare(right.scheduledDate);
    return left.sortOrder - right.sortOrder || left.createdAt - right.createdAt;
  });
}

/** 今天要做的：未完成且计划日期不晚于今天（含逾期），按重要优先排序 */
export function openTodosToday(todos: Todo[], today: string): Todo[] {
  return sortTodos(todos.filter(todo => !todo.completedAt && todo.scheduledDate <= today), today);
}

export function reorderTodos(todos: Todo[], ids: string[]): Todo[] {
  const rank = new Map(ids.map((id, index) => [id, index + 1]));
  return todos.map(todo => rank.has(todo.id) ? { ...todo, sortOrder: rank.get(todo.id)! } : todo);
}

export function importTodos(raw: string, existing: Todo[]): { todos: Todo[]; report: TodoImportReport } {
  const report: TodoImportReport = { added: 0, invalid: 0, duplicate: 0, overLimit: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { todos: existing, report: { ...report, invalid: 1 } };
  }
  const incoming = parsed && typeof parsed === "object" && Array.isArray((parsed as { todos?: unknown }).todos)
    ? (parsed as { todos: unknown[] }).todos
    : null;
  if (!incoming) return { todos: existing, report: { ...report, invalid: 1 } };
  const known = new Set(existing.map(todo => todo.id));
  const todos = [...existing];
  for (const candidate of incoming) {
    const error = validateTodo(candidate);
    if (error) { report.invalid += 1; continue; }
    const todo = candidate as Todo;
    if (known.has(todo.id)) { report.duplicate += 1; continue; }
    if (todos.length >= MAX_TODOS) { report.overLimit += 1; continue; }
    todos.push({ ...todo, text: todo.text.trim() });
    known.add(todo.id);
    report.added += 1;
  }
  return { todos, report };
}

export function exportTodos(todos: Todo[]): string {
  return JSON.stringify({ version: 1, todos }, null, 2);
}

export function overdueTodos(todos: Todo[], today: string): Todo[] {
  return todos.filter(todo => !todo.completedAt && todo.scheduledDate < today);
}
