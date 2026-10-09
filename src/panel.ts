/** 倒计时面板：主数字、显示切换、弹性退休滑块、其他倒计时、分享卡入口。 */
import { invoke } from "@tauri-apps/api/core";
import type { SpriteSet } from "./sprite";
import { store } from "./store";
import { closeToPet, getInfo, openSettings, setMode } from "./pet";
import { reminderMode, todayReminderStats } from "./reminder-center";
import { completeTodo, createTodo, exportTodos, importTodos, localDateKey, reorderTodos, sortTodos, type TodoCategory, type TodoPriority, type TodoRepeat } from "./todo-service";
import { refreshTodoCenter } from "./todo-center";
import { summaryBand, todayTodoCounts } from "./summary-service";
import { summaryText } from "./summary-texts";
import { confirmDialog, promptDialog, toast } from "./ui";

type AltMode = "ymd" | "workdays" | "seconds";

let altMode: AltMode = "ymd";
let flexMonths = 0;
let panelTimer: number | undefined;
let currentPage: "overview" | "todo" | "today" = "overview";

interface FullInfo {
  retire_date: string;
  days_left: number;
  workdays_left: { days: number; estimated: boolean };
  retire_age_label: string;
  flex_ym: string | null;
  flex_date: string | null;
  flex_days_left: number | null;
  progress: { ratio: number } | null;
  next_holiday: { name: string; date: string } | null;
}

async function fullInfo(flex: number): Promise<FullInfo> {
  const p = store.profile;
  return invoke<FullInfo>("get_retire_info", {
    birthYm: p.birthYm,
    birthDay: p.birthDay ?? null,
    category: p.category,
    joinYm: p.joinYm ?? null,
    flexMonths: flex,
  });
}

export async function renderPanel(page: "overview" | "todo" | "today" = currentPage) {
  currentPage = page;
  setMode("panel");
  document.querySelectorAll<HTMLButtonElement>("#p-tabs button").forEach(button => button.classList.toggle("on", button.dataset.page === page));
  (document.getElementById("p-overview") as HTMLElement).classList.toggle("hidden", page !== "overview");
  (document.getElementById("p-todo") as HTMLElement).classList.toggle("hidden", page !== "todo");
  (document.getElementById("p-today") as HTMLElement).classList.toggle("hidden", page !== "today");
  if (page === "todo") renderTodos();
  if (page === "today") renderToday();
  if (page !== "overview") return;
  const info = await fullInfo(flexMonths);
  const days = info.days_left >= 0 ? info.days_left : 0;
  (document.getElementById("p-days") as HTMLElement).textContent = `${days}`;
  (document.getElementById("p-age") as HTMLElement).textContent = info.retire_age_label;
  (document.getElementById("p-date") as HTMLElement).textContent = info.retire_date;

  renderAlt(info);

  // 弹性滑块
  const slider = document.getElementById("p-flex") as HTMLInputElement;
  slider.value = String(flexMonths);
  updateFlexLabel(info);

  // 进度条
  const row = document.getElementById("p-progress-row") as HTMLElement;
  if (info.progress) {
    row.hidden = false;
    (document.getElementById("p-bar") as HTMLElement).style.width =
      `${Math.round(info.progress.ratio * 100)}%`;
    (document.getElementById("p-progress") as HTMLElement).textContent =
      `${Math.round(info.progress.ratio * 100)}%`;
  } else {
    row.hidden = true;
  }

  // 其他倒计时
  renderOffWork();
  renderPayday();
  (document.getElementById("p-holiday") as HTMLElement).textContent =
    info.next_holiday ? `${info.next_holiday.name}（${info.next_holiday.date}）` : "-";
  const reminderStats = todayReminderStats();
  (document.getElementById("p-standups") as HTMLElement).textContent = `${reminderStats.standUps} 次`;
  (document.getElementById("p-water") as HTMLElement).textContent =
    `${reminderStats.waterCups} / ${store.settings.reminders.waterGoal} 杯`;
  (document.getElementById("p-missed") as HTMLElement).textContent = `${reminderStats.missed} 次`;

  panelPetLoop();
  window.clearInterval(panelTimer);
  panelTimer = window.setInterval(() => {
    renderOffWork();
    if (altMode === "seconds") {
      const inf = getInfo();
      if (inf && inf.days_left >= 0) {
        const sec = inf.days_left * 86400 - secondsIntoDay();
        (document.getElementById("p-alt") as HTMLElement).textContent =
          `≈ ${Math.max(0, sec).toLocaleString()} 秒`;
      }
    }
  }, 1000);
}

function renderTodos() {
  const list = document.getElementById("todo-list")!;
  list.replaceChildren();
  const today = localDateKey();
  const todayBox = document.createElement("section"); const futureBox = document.createElement("section");
  const doneBox = document.createElement("details"); const doneSummary = document.createElement("summary"); doneSummary.textContent = "已完成"; doneBox.appendChild(doneSummary);
  const title = (text: string) => { const el = document.createElement("h3"); el.textContent = text; return el; };
  todayBox.appendChild(title("今天")); futureBox.appendChild(title("以后"));
  for (const todo of sortTodos(store.todos, today)) {
    const row = document.createElement("div");
    row.className = "todo-row" + (todo.priority === "important" ? " important" : "") + (todo.completedAt ? " done" : "");
    row.draggable = !todo.completedAt;
    row.dataset.id = todo.id;
    const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = !!todo.completedAt;
    checkbox.addEventListener("change", () => { if (checkbox.checked) void completeFromPanel(todo.id, today); });
    const text = document.createElement("span"); text.className = "todo-text"; text.textContent = todo.text;
    const tag = document.createElement("span"); tag.className = "todo-tag"; tag.textContent = `${categoryLabel(todo.category)} · ${todo.scheduledDate}`;
    const edit = document.createElement("button"); edit.textContent = "编辑"; edit.onclick = () => editTodo(todo.id);
    const del = document.createElement("button"); del.textContent = "删除"; del.onclick = () => { void confirmDialog("删除这条待办？", "删除").then(ok => { if (ok) { store.todos = store.todos.filter(item => item.id !== todo.id); renderTodos(); } }); };
    row.addEventListener("dragstart", event => event.dataTransfer?.setData("text/plain", todo.id));
    row.addEventListener("dragover", event => event.preventDefault());
    row.addEventListener("drop", event => { event.preventDefault(); const moving = event.dataTransfer?.getData("text/plain"); if (!moving || moving === todo.id) return; const ids = [...list.querySelectorAll<HTMLElement>(".todo-row")].map(item => item.dataset.id!); ids.splice(ids.indexOf(moving), 1); ids.splice(ids.indexOf(todo.id), 0, moving); store.todos = reorderTodos(store.todos, ids); renderTodos(); });
    row.append(checkbox, text, tag, edit, del);
    (todo.completedAt ? doneBox : todo.scheduledDate <= today ? todayBox : futureBox).appendChild(row);
  }
  for (const box of [todayBox, futureBox]) {
    if (box.children.length === 1) { const empty = document.createElement("p"); empty.className = "todo-empty"; empty.textContent = "暂无"; box.appendChild(empty); }
  }
  if (doneBox.children.length === 1) { const empty = document.createElement("p"); empty.className = "todo-empty"; empty.textContent = "暂无"; doneBox.appendChild(empty); }
  list.append(todayBox, futureBox, doneBox);
}

async function completeFromPanel(id: string, today: string) {
  const original = store.todos.find(todo => todo.id === id);
  let nextWorkday = "";
  if (original?.repeat.kind === "workdays") {
    let candidate = new Date(today + "T00:00:00");
    for (let attempts = 0; attempts < 370; attempts += 1) {
      candidate.setDate(candidate.getDate() + 1);
      const date = localDateKey(candidate);
      const workday = await invoke<boolean>("is_workday", { date }).catch(() => {
        const day = candidate.getDay(); return day > 0 && day < 6;
      });
      if (workday) { nextWorkday = date; break; }
    }
  }
  store.todos = completeTodo(store.todos, id, today, date => date === nextWorkday, Date.now());
  renderTodos(); refreshTodoCenter();
}

function categoryLabel(category: TodoCategory): string { return ({ material: "材料", meeting: "会议", personal: "个人", other: "其他" })[category]; }

function renderToday() {
  const stats = todayReminderStats(); const counts = todayTodoCounts(store.todos, localDateKey());
  (document.getElementById("today-standups") as HTMLElement).textContent = `${stats.standUps} 次`;
  (document.getElementById("today-water") as HTMLElement).textContent = `${stats.waterCups} / ${store.settings.reminders.waterGoal} 杯`;
  (document.getElementById("today-eye") as HTMLElement).textContent = `${stats.eyeBreaks} 次`;
  (document.getElementById("today-exercise") as HTMLElement).textContent = `${stats.exercises} / ${store.settings.reminders.exerciseGoal} 次`;
  (document.getElementById("today-focus") as HTMLElement).textContent = `${stats.focusSessions} 次`;
  (document.getElementById("today-stress") as HTMLElement).textContent = `${stats.stressHits ?? 0} 次`;
  (document.getElementById("today-todos") as HTMLElement).textContent = `${counts.completed} / ${counts.total}`;
  (document.getElementById("today-missed") as HTMLElement).textContent = `${stats.missed} 次`;
  (document.getElementById("today-summary") as HTMLElement).textContent = summaryText(summaryBand(counts));
  const activeMode = reminderMode();
  (document.getElementById("today-mode") as HTMLElement).textContent = activeMode
    ? `${activeMode.kind === "focus" ? "专注" : activeMode.kind === "break" ? "休息" : "午休"}剩余 ${Math.ceil(activeMode.remainingMs / 60_000)} 分钟`
    : "";
}

function editTodo(id: string) {
  const todo = store.todos.find(item => item.id === id); if (!todo) return;
  void promptDialog("编辑待办（最多40字）", todo.text).then(text => {
    if (text === null) return;
    store.todos = store.todos.map(item => item.id === id ? { ...item, text } : item); renderTodos();
  });
}

function renderAlt(info: FullInfo) {
  const el = document.getElementById("p-alt") as HTMLElement;
  if (info.days_left < 0) {
    el.textContent = "已经退休啦，下面的数字仅供参考。";
    return;
  }
  if (altMode === "ymd") {
    const y = Math.floor(info.days_left / 365.25);
    const m = Math.floor((info.days_left - y * 365.25) / 30.44);
    const d = Math.round(info.days_left - y * 365.25 - m * 30.44);
    el.textContent = `≈ ${y} 年 ${m} 个月 ${d} 天`;
  } else if (altMode === "workdays") {
    el.textContent =
      `还有 ${info.workdays_left.days} 个工作日` + (info.workdays_left.estimated ? "（估算）" : "");
  } else {
    const sec = info.days_left * 86400 - secondsIntoDay();
    el.textContent = `≈ ${sec.toLocaleString()} 秒`;
  }
}

function secondsIntoDay(): number {
  const n = new Date();
  return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds();
}

function updateFlexLabel(info: FullInfo) {
  const label = document.getElementById("p-flex-label") as HTMLElement;
  if (flexMonths === 0 || !info.flex_date) {
    label.textContent = "法定";
    (document.getElementById("p-alt") as HTMLElement).textContent = "";
    void renderAlt(info);
    return;
  }
  const sign = flexMonths > 0 ? "+" : flexMonths < 0 ? "-" : "";
  label.textContent = `${sign}${Math.abs(Math.round(flexMonths / 12))}年${flexMonths % 12 !== 0 ? Math.abs(flexMonths % 12) + "月" : ""}`;
  const dateLine = document.getElementById("p-alt") as HTMLElement;
  if (info.flex_days_left != null) {
    dateLine.textContent = `弹性后：${info.flex_date} 退休（还有 ${Math.max(0, info.flex_days_left)} 天）`;
  }
}

function renderOffWork() {
  const [h, m] = store.settings.offWork.split(":").map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  let diff = Math.floor((target.getTime() - now.getTime()) / 1000);
  if (diff < 0) diff += 24 * 3600;
  const hh = Math.floor(diff / 3600), mm = Math.floor((diff % 3600) / 60);
  (document.getElementById("p-offwork") as HTMLElement).textContent = `${hh} 小时 ${mm} 分`;
}

function renderPayday() {
  const now = new Date();
  const day = store.settings.payday;
  let target = new Date(now.getFullYear(), now.getMonth(), day);
  if (target <= now) target = new Date(now.getFullYear(), now.getMonth() + 1, day);
  const days = Math.ceil((target.getTime() - now.getTime()) / 86400000);
  (document.getElementById("p-payday") as HTMLElement).textContent = `${days} 天（每月 ${day} 号）`;
}

/** 面板左上角的小头像放待机动画 */
let panelSprites: SpriteSet | null = null;

function panelPetLoop() {
  if (!panelSprites) return;
  const cv = document.getElementById("panel-pet") as HTMLCanvasElement;
  cv.width = 64; cv.height = 64;
  panelSprites.draw(cv.getContext("2d")!, "mood-01", 64);
}

export function bindPanel(sprites: SpriteSet) {
  panelSprites = sprites;
  document.getElementById("p-switch")?.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn) return;
    document.querySelectorAll("#p-switch button").forEach(b => b.classList.remove("on"));
    btn.classList.add("on");
    altMode = btn.getAttribute("data-mode") as AltMode;
    await renderPanel();
  });

  document.getElementById("p-flex")?.addEventListener("input", async (e) => {
    flexMonths = Number((e.target as HTMLInputElement).value);
    const info = await fullInfo(flexMonths);
    const days = (flexMonths === 0 ? info.days_left : info.flex_days_left) ?? info.days_left;
    (document.getElementById("p-days") as HTMLElement).textContent = `${Math.max(0, days)}`;
    updateFlexLabel(info);
  });

  document.getElementById("p-back")?.addEventListener("click", () => void closeToPet());
  document.getElementById("p-settings")?.addEventListener("click", () => void openSettings());
  document.getElementById("p-share")?.addEventListener("click", async () => {
    const { openShare } = await import("./share");
    void openShare(sprites);
  });
  document.getElementById("p-tabs")?.addEventListener("click", event => {
    const page = (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.page as typeof currentPage | undefined;
    if (page) void renderPanel(page);
  });
  document.getElementById("todo-add")?.addEventListener("click", () => {
    const input = document.getElementById("todo-text") as HTMLInputElement;
    try {
      const category = (document.getElementById("todo-category") as HTMLSelectElement).value as TodoCategory;
      const priority = (document.getElementById("todo-priority") as HTMLSelectElement).value as TodoPriority;
      const kind = (document.getElementById("todo-repeat") as HTMLSelectElement).value as TodoRepeat["kind"];
      const repeat: TodoRepeat = kind === "weekly" ? { kind, weekday: new Date().getDay() } : kind === "monthly" ? { kind, day: new Date().getDate() } : { kind } as TodoRepeat;
      const reminderValue = (document.getElementById("todo-reminder") as HTMLInputElement).value;
      const deadline = (document.getElementById("todo-deadline") as HTMLInputElement).value || null;
      const reminderAt = reminderValue ? new Date(reminderValue).getTime() : null;
      store.todos = [...store.todos, createTodo({ text: input.value, scheduledDate: localDateKey(), deadline, reminderAt, category, priority, repeat }, store.todos)];
      input.value = ""; renderTodos(); refreshTodoCenter();
    } catch (error) { toast(error instanceof Error ? error.message : "添加失败", "err"); }
  });
  document.getElementById("todo-export")?.addEventListener("click", () => {
    const blob = new Blob([exportTodos(store.todos)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "退休桌宠-待办.json"; link.click(); URL.revokeObjectURL(link.href);
  });
  document.getElementById("todo-import")?.addEventListener("click", () => (document.getElementById("todo-import-file") as HTMLInputElement).click());
  document.getElementById("todo-import-file")?.addEventListener("change", async event => {
    const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
    const result = importTodos(await file.text(), store.todos); store.todos = result.todos; toast(`已导入 ${result.report.added} 条；无效 ${result.report.invalid} 条，重复 ${result.report.duplicate} 条`); renderTodos();
  });
}
