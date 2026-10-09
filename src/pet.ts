/**
 * 桌宠形态：动画播放、时间段动作、拖拽、点击/双击/悬停、举牌、杯签。
 * 窗口只有一个：桌宠/面板/设置三种形态互相切换；扩窗（悬停卡、举牌、气泡）时
 * 始终锚定右下角，小人不动。
 */
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { cursorPosition, currentMonitor, availableMonitors } from "@tauri-apps/api/window";
import { PhysicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { SpriteSet } from "./sprite";
import { EVENT_RULES, recordClick, stickerWithReminderPriority } from "./pet-state";
import { store } from "./store";
import { pickLine, renderLine, type SceneKey } from "./lines-service";
import { Menu, MenuItem, CheckMenuItem, Submenu, PredefinedMenuItem } from "@tauri-apps/api/menu";
import {
  reopenPendingReminder,
  hasPendingReminder,
  respondToReminder,
  startFocus,
  startLunch,
  stopMode,
  reminderMode,
  startReminderCenter,
  updateReminderEnvironment,
  acknowledgeLunchAlarm,
} from "./reminder-center";
import type { ReminderRequest } from "./reminder-engine";
import { AnimationCatalog } from "./animation-assets";
import { PetAnimator } from "./pet-animator";
import { EVENT_ANIMATIONS, baseAnimationPlan, dayKey, randomDelay } from "./animation-config";
import { createTodo, localDateKey, moveOverdueToToday, overdueTodos } from "./todo-service";
import { respondToTodoReminder, startTodoCenter, updateTodoEnvironment } from "./todo-center";
import { confirmDialog, promptDialog } from "./ui";

export const appWindow = getCurrentWebviewWindow();

export const PET_SIZES = { 2: 96, 3: 128, 4: 160 } as const;
const petSize = () => PET_SIZES[scale as keyof typeof PET_SIZES] ?? 128;

export interface RetireInfo {
  retire_date: string;
  days_left: number;
  retire_age_label: string;
  base_age: number;
}

let sprites: SpriteSet | null = null;
let animations: AnimationCatalog | null = null;
let animator: PetAnimator | null = null;
let scale = 3;

let info: RetireInfo | null = null;
let infoAt = 0;

function configureAnimator() {
  if (!sprites || !animations) return;
  animator?.pause();
  animator = new PetAnimator(sprites, animations, {
    size: petSize,
    active: () => running && mode === "pet" && !hidden,
    enabled: () => store.settings.animations === true,
    reserveLift: pixels => {
      if (pixels > 0) void expandFor("animation", 0, pixels + 4);
      else void collapseFor("animation");
    },
  });
}

export function setSprites(s: SpriteSet) { sprites = s; configureAnimator(); }
export function setAnimations(value: AnimationCatalog) { animations = value; configureAnimator(); }
export function releaseAnimationFrames() { animations?.releaseAll(); }
export function setScale(v: number) {
  scale = v;
  animator?.invalidateSize();
  syncStageSize();
  resetBaseAnim();
}
export function getInfo(): RetireInfo | null { return info; }

export async function refreshInfo(force = false): Promise<RetireInfo | null> {
  const now = Date.now();
  if (!force && info && now - infoAt < 60_000) return info;
  const p = store.profile;
  if (!p.birthYm) return null;
  info = await invoke<RetireInfo>("get_retire_info", {
    birthYm: p.birthYm,
    birthDay: p.birthDay ?? null,
    category: p.category,
    joinYm: p.joinYm ?? null,
    flexMonths: 0,
  });
  infoAt = now;
  const badge = document.getElementById("day-badge");
  if (badge) { badge.textContent = `${Math.max(0, info.days_left)}天`; badge.classList.toggle("hidden", !store.settings.showBadge); }
  return info;
}

/* ---------------- 窗口尺寸与位置 ---------------- */

let baseSize = { w: 164, h: 186 };
let extraW = 0, extraH = 0;

export function setBaseSize(w: number, h: number) {
  baseSize = { w, h };
  document.documentElement.style.setProperty("--base-w", `${w}px`);
}

/** 小人靠近屏幕左侧、左边放不下文字框时，窗口改为向右长，所有框也镜像到小人右边 */
let flipRight = false;
const CARD_OFFSET = 104; // 与 styles.css 里 #hover-card 的 right/left 一致

let winQueue: Promise<void> = Promise.resolve();

function applyWindowSize(extraWL: number, extraHL: number): Promise<void> {
  winQueue = winQueue.then(async () => {
    // 面板/设置/分享已经接管窗口尺寸时，排队里还没执行的气泡/悬停卡扩缩窗必须作废，
    // 否则它们会在面板打开之后才执行，把面板窗口缩回小人大小（面板显示不完整）
    if (mode !== "pet") return;
    const sf = await appWindow.scaleFactor();
    const dW = (extraWL - extraW) * sf;
    const dH = (extraHL - extraH) * sf;
    if (dW === 0 && dH === 0) return;
    const pos = await appWindow.outerPosition();
    if (extraW === 0 && extraWL > 0) {
      // 从收起状态展开的这一刻决定方向；展开期间不变，避免中途镜像跳动
      try {
        const mon = await currentMonitor();
        flipRight = !!mon && (pos.x - mon.position.x) / sf < extraWL + 8;
      } catch { flipRight = false; }
      document.body.classList.toggle("flip", flipRight);
    }
    // 两个调用同一拍发出：分开 await 时窗口会先变大、过约一帧才挪位，小人会错位一下
    await Promise.all([
      appWindow.setSize(new LogicalSize(baseSize.w + extraWL, baseSize.h + extraHL)),
      appWindow.setPosition(new PhysicalPosition(pos.x - (flipRight ? 0 : Math.round(dW)), pos.y - Math.round(dH))),
    ]);
    extraW = extraWL; extraH = extraHL;
    if (extraW === 0 && flipRight) { flipRight = false; document.body.classList.remove("flip"); }
  }).catch(() => {});
  return winQueue;
}

/** 气泡 / 悬停卡 / 举牌各自登记需要多大的窗口，取最大值；谁收起谁撤销，互不打架 */
const needs = new Map<string, { w: number; h: number }>();

function syncNeeds(): Promise<void> {
  if (mode !== "pet") return winQueue;
  let w = 0, h = 0;
  for (const n of needs.values()) { w = Math.max(w, n.w); h = Math.max(h, n.h); }
  return applyWindowSize(w, h);
}

/** 展开窗口给气泡/悬停卡/举牌用（左/上方向长出来，小人不动） */
export function expandFor(key: string, wl: number, hl: number): Promise<void> {
  needs.set(key, { w: Math.ceil(wl), h: Math.ceil(hl) });
  return syncNeeds();
}

/** 撤销某一项的扩窗需求 */
export function collapseFor(key: string): Promise<void> {
  needs.delete(key);
  return syncNeeds();
}

/** 主屏 = 包含 (0,0) 的那块（macOS 菜单栏所在屏） */
async function primaryMonitor() {
  try {
    const all = await availableMonitors();
    const primary = all.find(m =>
      m.position.x <= 0 && m.position.y <= 0 &&
      m.position.x + m.size.width > 0 && m.position.y + m.size.height > 0);
    return primary ?? all[0] ?? null;
  } catch {
    return currentMonitor();
  }
}

export async function placeWindowBottomRight() {
  const mon = await primaryMonitor();
  const sf = await appWindow.scaleFactor();
  const w = Math.round(baseSize.w * sf), h = Math.round(baseSize.h * sf);
  if (mon) {
    const x = mon.position.x + mon.size.width - w - Math.round(24 * sf);
    const y = mon.position.y + mon.size.height - h - Math.round(48 * sf);
    await appWindow.setPosition(new PhysicalPosition(x, y));
  }
}

export async function restoreOrPlace() {
  const saved = store.windowPos;
  const sf = await appWindow.scaleFactor();
  const w = Math.round(baseSize.w * sf), h = Math.round(baseSize.h * sf);
  if (saved) {
    // 找包含存档位置中心的显示器；都不包含（副屏拔了/虚拟屏）就回主屏右下角
    let mon: import("@tauri-apps/api/window").Monitor | null = null;
    try {
      const all = await availableMonitors();
      const cx = saved.x + w / 2, cy = saved.y + h / 2;
      mon = all.find(m =>
        cx >= m.position.x && cx < m.position.x + m.size.width &&
        cy >= m.position.y && cy < m.position.y + m.size.height) ?? null;
    } catch { mon = null; }
    if (!mon) {
      store.windowPos = null;
      await placeWindowBottomRight();
      return;
    }
    const mx = mon.position.x, my = mon.position.y;
    const mw = mon.size.width, mh = mon.size.height;
    const x = Math.min(Math.max(saved.x, mx), mx + mw - w);
    const y = Math.min(Math.max(saved.y, my), my + mh - h);
    await appWindow.setPosition(new PhysicalPosition(x, y));
    store.windowPos = { x, y };
  } else {
    await placeWindowBottomRight();
  }
  void sf; void w; void h;
}

/* ---------------- 表情状态与轻量动画 ---------------- */

let temp: { id: string; until: number; mode: "loop" | "once" } | null = null;
let reminderStickerId: string | null = null;
let tempTimer: number | undefined;
let teaTimer: number | undefined;
let tiltTimer: number | undefined;
let baseTimer: number | undefined;
let baseActionTimer: number | undefined;
let idleTimer: number | undefined;
let basePlanContext = "";
const completedBaseActions = new Set<string>();
let running = false;
let hidden = false;

function syncStageSize() {
  const size = petSize();
  const stage = document.getElementById("stage");
  if (!stage) return;
  stage.style.width = `${size + 6}px`;
  stage.style.height = `${size + 6}px`;
  document.documentElement.style.setProperty("--pet-size", `${size}px`);
}

function clearBaseTimers(resetContext = true) {
  window.clearTimeout(baseActionTimer);
  window.clearTimeout(idleTimer);
  if (resetContext) basePlanContext = "";
}

function baseContext(now: Date): string {
  const plan = baseAnimationPlan(now, store.settings.meetingMode);
  return `${dayKey(now)}:${plan.key}`;
}

function playIdleCycle() {
  if (!animator || !running || hidden || mode !== "pet" || reminderStickerId || temp) return;
  const context = baseContext(new Date());
  if (context !== basePlanContext) {
    startBasePlan(true);
    return;
  }
  void animator.play("mood-01", {
    mode: "once",
    restart: true,
    fallbackMs: 1000,
    onDone: () => {
      if (!running || hidden || mode !== "pet" || reminderStickerId || temp) return;
      idleTimer = window.setTimeout(playIdleCycle, randomDelay([3000, 6000]));
    },
  });
}

function startBasePlan(force = false) {
  if (!animator || !running || hidden || mode !== "pet" || reminderStickerId || temp) return;
  const now = new Date();
  const plan = baseAnimationPlan(now, store.settings.meetingMode);
  const context = `${dayKey(now)}:${plan.key}`;
  if (!force && context === basePlanContext) return;
  clearBaseTimers(false);
  basePlanContext = context;

  if (!plan.animated) {
    void animator.play(plan.id, { mode: "loop", restart: force, useAnimation: false });
    return;
  }
  if (plan.key === "idle") {
    playIdleCycle();
    return;
  }
  if (plan.mode === "loop") {
    void animator.play(plan.id, { mode: "loop", restart: force });
    return;
  }

  const completionKey = `${context}:${plan.id}`;
  if (plan.oncePerDay && completedBaseActions.has(completionKey)) {
    playIdleCycle();
    return;
  }
  void animator.play(plan.id, {
    mode: "once",
    restart: true,
    fallbackMs: EVENT_ANIMATIONS[plan.id]?.durationMs ?? 1200,
    onDone: () => {
      if (plan.oncePerDay) completedBaseActions.add(completionKey);
      if (plan.repeatAfterMs) {
        baseActionTimer = window.setTimeout(() => startBasePlan(true), randomDelay(plan.repeatAfterMs));
      }
      playIdleCycle();
    },
  });
}

function refreshSticker() {
  if (!animator || !running || hidden || mode !== "pet") return;
  if (temp && Date.now() >= temp.until && temp.until !== Infinity) temp = null;
  const selected = stickerWithReminderPriority(reminderStickerId, temp?.id ?? null, "");
  if (selected && reminderStickerId) {
    clearBaseTimers();
    void animator.play(selected, { mode: "loop", useAnimation: false });
    return;
  }
  if (selected && temp) return;
  startBasePlan();
}

export function playTemp(id: string, duration?: number) {
  if (!animator || (reminderStickerId && id !== reminderStickerId)) return;
  window.clearTimeout(tempTimer);
  clearBaseTimers();
  const event = EVENT_ANIMATIONS[id];
  const configured = Object.values(EVENT_RULES).find(rule => rule.id === id);
  const ms = duration ?? event?.durationMs ?? configured?.duration ?? 2000;
  const eventMode = duration === 0 ? "loop" : event?.mode ?? "once";
  temp = { id, mode: eventMode, until: eventMode === "once" || ms === 0 ? Infinity : Date.now() + ms };
  const activeTemp = temp;
  void animator.play(id, {
    mode: eventMode,
    restart: true,
    fallbackMs: ms || 1200,
    onDone: eventMode === "once" ? () => {
      if (temp === activeTemp) {
        temp = null;
        refreshSticker();
      }
    } : undefined,
  });
  if (eventMode === "loop" && ms > 0) {
    tempTimer = window.setTimeout(() => {
      if (temp === activeTemp) {
        temp = null;
        refreshSticker();
      }
    }, ms);
  }
}

export function resetBaseAnim() {
  clearBaseTimers();
  animator?.invalidateSize();
  refreshSticker();
}

function scheduleTea() {
  window.clearTimeout(teaTimer);
  teaTimer = window.setTimeout(() => {
    const now = new Date();
    const workday = now.getDay() >= 1 && now.getDay() <= 5;
    if (running && mode === "pet" && !hidden && workday && !store.settings.meetingMode && !temp && baseAnimationPlan(now, false).key === "idle") {
      playTemp(EVENT_RULES.tea.id);
    }
    scheduleTea();
  }, (10 + Math.random() * 10) * 60_000);
}

function scheduleTilt() {
  window.clearTimeout(tiltTimer);
  tiltTimer = window.setTimeout(() => {
    if (running && mode === "pet" && !hidden) {
      const stage = document.getElementById("stage")!;
      stage.classList.add("tilt");
      window.setTimeout(() => stage.classList.remove("tilt"), 600);
    }
    scheduleTilt();
  }, (8 + Math.random() * 7) * 1000);
}

export function startLoop() {
  if (running) return;
  running = true;
  document.getElementById("stage")?.classList.remove("paused");
  syncStageSize();
  refreshSticker();
  scheduleTea();
  scheduleTilt();
  baseTimer = window.setInterval(refreshSticker, 15_000);
}

export function stopLoop() {
  running = false;
  document.getElementById("stage")?.classList.add("paused");
  window.clearTimeout(teaTimer);
  window.clearTimeout(tiltTimer);
  window.clearInterval(baseTimer);
  clearBaseTimers();
  animator?.pause();
}

/* ---------------- 杯签 / 气泡 / 悬停卡 ---------------- */

/** 当前时段对应的台词场景 */
function sceneByTime(): SceneKey {
  const now = new Date();
  const h = now.getHours(), day = now.getDay();
  if (day === 5 && h >= 14) return "friday";
  if (h >= 8 && h < 9) return "morning";
  if (h >= 11 && h < 13) return "lunch";
  if (h >= 14 && h < 16) return "afternoon";
  if (h >= 17) return "evening";
  return "general";
}

/** 按当前配置抽一句台词（{days} 已替换） */
function speakLine(scene?: SceneKey): string {
  const sc = scene ?? sceneByTime();
  const nearRetire = info != null && info.days_left >= 0 && info.days_left < 365;
  const r = pickLine(store.linesCfg, sc, { nearRetire });
  return renderLine(r.text, info ? info.days_left : null);
}

let bubbleTimer: number | undefined;

/** 气泡按文字多少自动变大；窗口随之向左/上扩大，保证每个字都显示完整 */
async function showBubble(text: string, force = false) {
  if (!force && !store.settings.showBubble) return;
  if (!force && hasPendingReminder()) return;
  const el = document.getElementById("bubble")!;
  window.clearTimeout(bubbleTimer);
  el.classList.remove("reminder");
  el.textContent = text;
  el.classList.remove("hidden");
  el.style.visibility = "hidden";
  const r = el.getBoundingClientRect();
  // 气泡右缘在舞台右缘（距窗口右边 6px），底边距窗口底 6+128px；预留尾巴 8px 和边距 6px
  const needW = Math.max(0, Math.ceil(r.width) + 6 - (baseSize.w - 6));
  const needH = Math.max(0, Math.ceil(r.height) + 8 + 6 - (baseSize.h - 6 - petSize()));
  await expandFor("bubble", needW, needH);
  el.style.visibility = "visible";
  bubbleTimer = window.setTimeout(() => {
    el.classList.add("hidden");
    void collapseFor("bubble");
  }, 3000 + Math.min(3000, Math.max(0, text.length - 12) * 100));
}

function clearReminderSticker() {
  reminderStickerId = null;
  refreshSticker();
}

async function showReminderBubble(request: ReminderRequest, text: string) {
  if (mode !== "pet" || hidden) return;
  const el = document.getElementById("bubble")!;
  window.clearTimeout(bubbleTimer);
  el.replaceChildren();
  el.classList.add("reminder");

  const title = document.createElement("div");
  title.className = "reminder-title";
  title.textContent = ({ sedentary: "久坐提醒", water: "喝水提醒", eye: "护眼提醒", exercise: "运动提醒" })[request.kind];
  const message = document.createElement("div");
  message.className = "reminder-message";
  message.textContent = text;
  const actions = document.createElement("div");
  actions.className = "reminder-actions";
  const choices = [
    [request.kind === "water" ? "喝了" : request.kind === "eye" ? "看了" : request.kind === "exercise" ? "做了" : "做完了", "done"],
    [request.kind === "eye" ? "等会儿（5 分钟）" : "等会儿", "later"],
    ["今天不提醒", "mute-today"],
  ] as const;
  for (const [label, action] of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("mousedown", event => event.stopPropagation());
    button.addEventListener("click", event => {
      event.stopPropagation();
      respondToReminder(action);
    });
    actions.appendChild(button);
  }
  el.append(title, message, actions);
  el.classList.remove("hidden");
  el.style.visibility = "hidden";
  const rect = el.getBoundingClientRect();
  const needW = Math.max(0, Math.ceil(rect.width) + 6 - (baseSize.w - 6));
  const needH = Math.max(0, Math.ceil(rect.height) + 8 + 6 - (baseSize.h - 6 - petSize()));
  await expandFor("bubble", needW, needH);
  el.style.visibility = "visible";

  reminderStickerId = `health-${String(request.healthIndex).padStart(2, "0")}`;
  window.clearTimeout(tempTimer);
  temp = null;
  refreshSticker();
  bubbleTimer = window.setTimeout(collapseReminderBubble, 8000);
}

function collapseReminderBubble() {
  const el = document.getElementById("bubble")!;
  window.clearTimeout(bubbleTimer);
  el.classList.add("hidden");
  el.classList.remove("reminder");
  void collapseFor("bubble");
}

function hideReminderBubble() {
  collapseReminderBubble();
  clearReminderSticker();
}

async function showTodoReminder(todo: import("./todo-service").Todo) {
  if (mode !== "pet" || hidden) return;
  void showSign("", todo.text.slice(0, 8) + (todo.text.length > 8 ? "…" : ""));
  const el = document.getElementById("bubble")!;
  window.clearTimeout(bubbleTimer);
  el.replaceChildren();
  el.classList.add("reminder");
  const title = document.createElement("div");
  title.className = "reminder-title";
  title.textContent = "待办提醒";
  const message = document.createElement("div");
  message.className = "reminder-message";
  message.textContent = todo.text;
  const actions = document.createElement("div");
  actions.className = "reminder-actions";
  for (const [label, action] of [["完成", "done"], ["稍后10分钟", "later"], ["明天再说", "tomorrow"]] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", event => {
      event.stopPropagation();
      void respondToTodoReminder(action);
    });
    actions.appendChild(button);
  }
  el.append(title, message, actions);
  el.classList.remove("hidden");
  el.style.visibility = "hidden";
  const rect = el.getBoundingClientRect();
  await expandFor("bubble", Math.max(0, Math.ceil(rect.width) + 6 - (baseSize.w - 6)), Math.max(0, Math.ceil(rect.height) + 14 - (baseSize.h - 6 - petSize())));
  el.style.visibility = "visible";
}

async function openQuickTodo() {
  const text = await promptDialog("加一条待办（今天）");
  if (!text?.trim()) return;
  try {
    store.todos = [...store.todos, createTodo({
      text, scheduledDate: localDateKey(), deadline: null, reminderAt: null,
      category: "other", priority: "normal", repeat: { kind: "once" },
    }, store.todos)];
    void showBubble("记下啦", true);
  } catch (error) { void showBubble(error instanceof Error ? error.message : "添加失败", true); }
}

function showDailyRollover() {
  const overdue = overdueTodos(store.todos, localDateKey());
  if (!overdue.length || mode !== "pet" || hidden) return;
  playTemp("mood-10");
  const el = document.getElementById("bubble")!;
  el.replaceChildren(); el.classList.add("reminder");
  const message = document.createElement("div"); message.className = "reminder-message";
  message.textContent = `昨天还有 ${overdue.length} 件没做完`;
  const actions = document.createElement("div"); actions.className = "reminder-actions";
  for (const [label, action] of [["挪到今天", "today"], ["保留原日期", "leave"], ["全部删除", "delete"]] as const) {
    const button = document.createElement("button"); button.textContent = label;
    button.onclick = () => {
      const ids = overdue.map(todo => todo.id);
      if (action === "today") store.todos = moveOverdueToToday(store.todos, ids, localDateKey());
      if (action === "delete") void confirmDialog("删除昨天未完成的待办？", "删除").then(ok => { if (ok) store.todos = store.todos.filter(todo => !ids.includes(todo.id)); });
      collapseReminderBubble();
    };
    actions.appendChild(button);
  }
  el.append(message, actions); el.classList.remove("hidden");
  void expandFor("bubble", 190, 90);
}

let hoverTimer: number | undefined;
let hoverHideTimer: number | undefined;

async function showHoverCard() {
  const card = document.getElementById("hover-card")!;
  const inf = await refreshInfo();
  if (!inf || inf.days_left < 0) return;
  const y = Math.floor(inf.days_left / 365.25);
  const m = Math.floor((inf.days_left - y * 365.25) / 30.44);
  const d = inf.days_left - y * 365 - m * 30;
  card.innerHTML =
    `<h3>退休倒计时</h3>` +
    `<div>还有 <b>${inf.days_left}</b> 天</div>` +
    `<div>≈ ${y} 年 ${m} 个月 ${d} 天</div>` +
    `<div>${inf.retire_date}（${inf.retire_age_label}）退休</div>`;
  card.style.visibility = "hidden";
  card.classList.remove("hidden");
  const rect = card.getBoundingClientRect();
  // 卡片是 position:absolute; right:Npx 贴在小人左侧，窗口宽度必须包含这个右偏移，否则左边会被裁掉
  const needW = Math.max(0, Math.ceil(rect.width + CARD_OFFSET) + 12 - baseSize.w);
  const needH = Math.max(0, Math.ceil(rect.height) + petSize() + 18 - baseSize.h);
  await expandFor("hover", needW, needH);
  card.style.visibility = "visible";
}

function hideHoverCard() {
  document.getElementById("hover-card")!.classList.add("hidden");
  document.getElementById("hover-card")!.style.visibility = "";
  void collapseFor("hover");
}

/* ---------------- 举牌 ---------------- */

let signing = false;

export async function showSign(text: string, digits?: string, milestone = false) {
  if (signing || !sprites) return;
  signing = true;
  await expandFor("sign", 160, 82);
  const banner = document.getElementById("sign-banner")!;
  const board = document.getElementById("board-text")!;
  banner.textContent = text;
  banner.classList.toggle("hidden", !milestone);
  const rect = (await animator?.getSpec("mood-16"))?.boardRect ?? sprites.sticker("mood-16").boardRect!;
  const size = petSize();
  board.textContent = digits ?? "";
  board.style.width = `${size * rect.w}px`;
  board.style.height = `${size * rect.h}px`;
  board.style.right = flipRight ? "auto" : `${size * (1 - rect.x - rect.w)}px`;
  board.style.left = flipRight ? `${size * rect.x}px` : "auto";
  board.style.bottom = `${size * (1 - rect.y - rect.h)}px`;
  board.style.fontSize = `${Math.min(size * rect.h * .68, size * rect.w / Math.max(1, (digits ?? "").length) * 1.4)}px`;
  board.classList.toggle("hidden", !digits);
  playTemp(EVENT_RULES.sign.id);
  await new Promise(resolve => window.setTimeout(resolve, EVENT_RULES.sign.duration));
  banner.classList.add("hidden");
  board.classList.add("hidden");
  await collapseFor("sign");
  signing = false;
  if (milestone) playTemp(EVENT_RULES.milestone.id);
}

/** 每天第一次启动举牌 + 里程碑 */
export async function checkSignEvents() {
  const inf = await refreshInfo(true);
  if (!inf || inf.days_left < 0) return;
  const today = new Date();
  const key = `sign-${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  let text = `还剩 ${inf.days_left} 天！`;
  let milestone: string | null = null;
  const fired = store.milestones;
  for (const n of [1000, 500, 365, 100, 30, 1]) {
    if (inf.days_left === n && !fired[`d${n}`]) {
      milestone = `d${n}`;
      text = `还剩 ${n} 天！`;
    }
  }
  const lastNational = lastNationalDay(inf);
  if (!milestone && lastNational) {
    milestone = lastNational.id;
    text = lastNational.text;
  }
  if (!localStorage.getItem("rdp.v1." + key)) {
    localStorage.setItem("rdp.v1." + key, "1");
    if (milestone) store.fireMilestone(milestone);
    void showSign(text, `${inf.days_left}`, !!milestone);
    return;
  }
  if (milestone) {
    store.fireMilestone(milestone);
    void showSign(text, `${inf.days_left}`, !!milestone);
  }
}

function lastNationalDay(inf: RetireInfo): { id: string; text: string } | null {
  const retire = new Date(inf.retire_date + "T00:00:00");
  const now = new Date();
  const y = now.getFullYear();
  for (const cy of [y, y + 1, y + 2]) {
    const nat = new Date(cy, 9, 1); // 10月1日
    if (nat > now && nat < retire) {
      const nextNat = new Date(cy + 1, 9, 1);
      if (nextNat >= retire) {
        return { id: `national-${cy}`, text: "最后一个国庆！" };
      }
      return null;
    }
  }
  return null;
}

/* ---------------- 拖拽 / 点击 ---------------- */

let dragging = false;
let clicks: number[] = [];
let mode: "pet" | "panel" | "settings" | "share" = "pet";

export function setMode(m: typeof mode) { mode = m; }

function setupPointer() {
  const cv = document.getElementById("stage") as HTMLElement;
  let startX = 0, startY = 0, winX = 0, winY = 0, moved = false, down = false;

  cv.addEventListener("mousedown", async (e) => {
    if (e.button !== 0) return;   // 右键只弹菜单，别当成拖拽
    if ((e.target as HTMLElement).closest("#bubble button")) return;
    if (mode !== "pet" || signing) return;
    if (acknowledgeLunchAlarm()) return;
    down = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    const pos = await appWindow.outerPosition();
    winX = pos.x; winY = pos.y;
  });

  window.addEventListener("mousemove", async (e) => {
    if (!down || mode !== "pet") return;
    if (!moved && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 4) {
      moved = true;
      dragging = true;
      cv.classList.add("dragging");
      playTemp(EVENT_RULES.drag.id, 0);
      hideHoverCard();
    }
    if (dragging) {
      const cur = await cursorPosition();
      const sf = await appWindow.scaleFactor();
      const gx = Math.round((startX) * sf), gy = Math.round((startY) * sf);
      let nx = cur.x - gx, ny = cur.y - gy;
      // 拖出屏幕时钳回最近显示器，别让狗丢在屏幕外
      const mon = await currentMonitor();
      if (mon) {
        const w = Math.round(baseSize.w * sf), h = Math.round(baseSize.h * sf);
        nx = Math.min(Math.max(nx, mon.position.x), mon.position.x + mon.size.width - Math.round(40 * sf));
        ny = Math.min(Math.max(ny, mon.position.y), mon.position.y + mon.size.height - Math.round(40 * sf));
        void w; void h;
      }
      await appWindow.setPosition(new PhysicalPosition(Math.round(nx), Math.round(ny)));
      void winX; void winY;
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (e.button !== 0 || !down) return;
    down = false;
    if (dragging) {
      dragging = false;
      cv.classList.remove("dragging");
      void (async () => {
        const pos = await appWindow.outerPosition();
        const mon = await currentMonitor();
        if (mon) {
          const sf = await appWindow.scaleFactor();
          const w = Math.round(baseSize.w * sf), h = Math.round(baseSize.h * sf);
          const x = Math.min(Math.max(pos.x, mon.position.x), mon.position.x + mon.size.width - w);
          const y = Math.min(Math.max(pos.y, mon.position.y), mon.position.y + mon.size.height - h);
          store.windowPos = { x, y };
        } else {
          store.windowPos = { x: pos.x, y: pos.y };
        }
      })();
      temp = null;
      refreshSticker();
      return;
    }
    if (reopenPendingReminder()) return;
    const result = recordClick(clicks, Date.now());
    clicks = result.angry ? [] : result.clicks;
    playTemp(result.angry ? EVENT_RULES.angry.id : EVENT_RULES.poke.id);
    if (!result.angry) void showBubble(speakLine());
  });

  cv.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (mode !== "pet" || dragging || signing) return;
    hideHoverCard();
    void showContextMenu().catch((err) => {
      void invoke("debug_log", { msg: `contextmenu: ${err instanceof Error ? err.stack : String(err)}` });
    });
  });

  cv.addEventListener("mouseenter", () => {
    window.clearTimeout(hoverTimer);
    window.clearTimeout(hoverHideTimer);
    hoverTimer = window.setTimeout(() => { if (!dragging && mode === "pet") void showHoverCard(); }, 500);
  });
  cv.addEventListener("mouseleave", () => {
    window.clearTimeout(hoverTimer);
    // 窗口扩缩的瞬间小人会短暂离开鼠标下方，立刻收卡片会形成 展开→离开→收起→进入→展开 的闪烁循环；
    // 延迟收起，期间鼠标回来（mouseenter）就取消
    hoverHideTimer = window.setTimeout(hideHoverCard, 250);
  });
}

/** 设置保存成功后：刷新退休数据和杯签，让小人说一句，告诉用户确实存好了 */
export async function afterProfileSaved() {
  try {
    const inf = await refreshInfo(true);
      if (inf) {
      const [y, m, d] = inf.retire_date.split("-").map(Number);
      void showBubble(inf.days_left >= 0
        ? `已保存。${y}年${m}月${d}日退休，还有 ${inf.days_left} 天`
        : "已保存。你已经到退休年龄啦");
    } else {
      void showBubble("已保存");
    }
  } catch (e) {
    void showBubble(`已保存，但算退休日期时出错：${e}`);
  }
}

/* ---------------- 右键菜单 ---------------- */

/** 右键小人：原生菜单，在鼠标位置弹出，不占桌宠窗口的地方 */
async function showContextMenu() {
  const s = store.settings;
  const sizeItems = await Promise.all(([[2, "小"], [3, "中"], [4, "大"]] as const).map(([n, label]) =>
    CheckMenuItem.new({
      text: `${label}（${PET_SIZES[n]}px）`,
      checked: s.scale === n,
      action: () => void changeScale(n),
    })));
  const menu = await Menu.new({
    items: [
      await MenuItem.new({ text: "倒计时面板", action: () => void openPanel() }),
      await MenuItem.new({ text: "加一条待办", action: openQuickTodo }),
      await MenuItem.new({ text: "今日小结", action: () => void openPanel("today") }),
      ...(reminderMode()
        ? [await MenuItem.new({ text: "结束专注/午休", action: () => { stopMode(); } })]
        : [
            await MenuItem.new({ text: "开始专注", action: () => { startFocus(); } }),
            await MenuItem.new({ text: "开始午休", action: () => { void chooseLunchDuration(); } }),
          ]),
      await MenuItem.new({ text: "设置…", action: () => void openSettings() }),
      await MenuItem.new({ text: "说句话", action: () => { playTemp(EVENT_RULES.poke.id); void showBubble(speakLine()); } }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await CheckMenuItem.new({
        text: "显示台词气泡", checked: s.showBubble,
        action: () => { const c = store.settings; c.showBubble = !c.showBubble; store.settings = c; },
      }),
      await CheckMenuItem.new({
        text: "开会模式", checked: s.meetingMode,
        action: () => {
          const c = store.settings;
          c.meetingMode = !c.meetingMode;
          store.settings = c;
          temp = null;
          refreshSticker();
          updateReminderEnvironment({});
          updateTodoEnvironment({});
        },
      }),
      await Submenu.new({ text: "桌宠大小", items: sizeItems }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ text: "隐藏（老板键同效）", action: () => void invoke("boss_toggle") }),
      await MenuItem.new({ text: "退出", action: () => void invoke("quit_app") }),
    ],
  });
  await menu.popup();
}

async function chooseLunchDuration(): Promise<void> {
  const defaultWake = store.settings.reminders.lunchWakeTime;
  const value = await promptDialog("午休多久？填分钟，或填唤醒时间（如 13:30）", defaultWake);
  if (value == null) return;
  const now = new Date();
  let minutes = Number(value);
  if (/^\d{1,2}:\d{2}$/.test(value)) {
    const [hour, minute] = value.split(":").map(Number);
    const wake = new Date(now); wake.setHours(hour, minute, 0, 0);
    minutes = Math.round((wake.getTime() - now.getTime()) / 60_000);
  }
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 120) {
    void showBubble("唤醒时间要在接下来两小时内，已按默认午休时长开始。", true);
    startLunch();
    return;
  }
  startLunch(Date.now(), Math.round(minutes));
}

async function changeScale(n: 2 | 3 | 4) {
  const c = store.settings;
  if (c.scale === n) return;
  c.scale = n;
  store.settings = c;
  setScale(n);
  setBaseSize(PET_SIZES[n] + 36, PET_SIZES[n] + 58);
  resetBaseAnim();
  await closeToPet();
}

/* ---------------- 面板/设置切换 ---------------- */

/** 台词页「试说一次」：收起设置回到桌宠，立刻说这句 */
export async function previewLine(text: string) {
  if (mode !== "pet") await closeToPet();
  showBubble(text);
}

export async function openPanel(page: "overview" | "todo" | "today" = "overview") {
  mode = "panel";
  store.mode = "panel";
  hideHoverCard();
  stopLoop();
  await appWindow.setAlwaysOnTop(false);
  await applyWindowSizeAbsolute(480, 660);
  document.getElementById("pet-view")!.classList.add("hidden");
  document.getElementById("panel-view")!.classList.remove("hidden");
  const { renderPanel } = await import("./panel");
  await renderPanel(page);
}

export async function openSettings() {
  mode = "settings";
  store.mode = "settings";
  hideHoverCard();
  stopLoop();
  await appWindow.setAlwaysOnTop(false);
  await applyWindowSizeAbsolute(520, 680);
  document.getElementById("pet-view")!.classList.add("hidden");
  document.getElementById("settings-view")!.classList.remove("hidden");
  const { renderSettings } = await import("./settings");
  renderSettings();
}

export async function closeToPet() {
  needs.clear();
  mode = "pet";
  store.mode = "pet";
  document.getElementById("panel-view")!.classList.add("hidden");
  document.getElementById("settings-view")!.classList.add("hidden");
  document.getElementById("share-view")!.classList.add("hidden");
  await applyWindowSizeAbsolute(0, 0);
  await appWindow.setAlwaysOnTop(true);
  await restoreOrPlace();
  document.getElementById("pet-view")!.classList.remove("hidden");
  startLoop();
  resetBaseAnim();
  reopenPendingReminder();
}

async function applyWindowSizeAbsolute(extraWL: number, extraHL: number) {
  await winQueue;   // 等排队中的扩缩窗做完（它们会因 mode 已变而自行作废），再设定面板尺寸
  await appWindow.setSize(new LogicalSize(baseSize.w + extraWL, baseSize.h + extraHL));
  if (extraWL > 0) {
    // 面板/设置居中到主屏，别跟着小人的位置跑到角落或副屏去
    const mon = await primaryMonitor();
    if (mon) {
      const sf = await appWindow.scaleFactor();
      const w = Math.round((baseSize.w + extraWL) * sf);
      const h = Math.round((baseSize.h + extraHL) * sf);
      const x = mon.position.x + Math.max(0, Math.round((mon.size.width - w) / 2));
      const y = mon.position.y + Math.max(0, Math.round((mon.size.height - h) / 2.6));
      await appWindow.setPosition(new PhysicalPosition(x, y));
    }
  }
  extraW = extraWL; extraH = extraHL;
}

/* ---------------- 事件与启动 ---------------- */

export async function setupPet() {
  document.getElementById("x-panel")?.addEventListener("click", () => void closeToPet());
  document.getElementById("x-settings")?.addEventListener("click", () => void closeToPet());
  scale = store.settings.scale;
  setupPointer();
  startLoop();
  resetBaseAnim();

  startReminderCenter({
    show: (request, text) => { void showReminderBubble(request, text); },
    hide: hideReminderBubble,
    goalReached: () => { void showBubble("今天喝够啦", true); },
    modeMessage: (text, sticker) => {
      reminderStickerId = sticker === "lunch" ? "mood-05" : sticker === "focus" ? "mood-01" : null;
      refreshSticker();
      void showBubble(text, true);
    },
  });
  startTodoCenter({
    show: todo => { void showTodoReminder(todo); },
    hide: hideReminderBubble,
    showSummary: text => { void showBubble(text, true); },
  });
  window.setTimeout(showDailyRollover, 500);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { stopLoop(); releaseAnimationFrames(); } else if (!hidden && mode === "pet") startLoop();
  });
  await listen("pet:boss-hidden", () => {
    hidden = true;
    updateReminderEnvironment({ bossHidden: true });
    updateTodoEnvironment({ bossHidden: true });
    releaseAnimationFrames();
    stopLoop();
  });
  await listen("pet:boss-shown", () => {
    hidden = false;
    updateReminderEnvironment({ bossHidden: false });
    updateTodoEnvironment({ bossHidden: false });
    startLoop();
  });
  await listen("pet:avoid-hidden", () => {
    updateReminderEnvironment({ fullscreen: true });
    updateTodoEnvironment({ fullscreen: true });
    releaseAnimationFrames();
    if (mode === "pet") void appWindow.hide();
    stopLoop();
  });
  await listen("pet:avoid-shown", () => {
    updateReminderEnvironment({ fullscreen: false });
    updateTodoEnvironment({ fullscreen: false });
    if (mode === "pet" && !hidden) { void appWindow.show(); startLoop(); }
  });
  await listen<string>("ui:open", (e) => {
    const target = e.payload;
    if (target === "panel") void openPanel();
    else if (target === "settings") void openSettings();
    else if (target === "pet") void closeToPet();
  });

  void checkSignEvents();
}
