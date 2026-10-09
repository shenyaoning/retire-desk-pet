import { invoke } from "@tauri-apps/api/core";
import {
  acknowledgeReminder,
  createReminderState,
  localDateKey,
  tickReminderState,
  type ReminderAction,
  type ReminderEnvironment,
  type ReminderRequest,
  type ReminderSettings,
  type ReminderState,
} from "./reminder-engine";
import { reminderText, specialReminderText } from "./reminder-texts";
import { store } from "./store";
import { pruneDailyStats } from "./summary-service";
import { beginMode, recordAlarm, tickModeState, type ModeState } from "./mode-state";

export interface ReminderView {
  show(request: ReminderRequest, text: string): void;
  hide(): void;
  goalReached(): void;
  modeMessage(text: string, sticker: "focus" | "lunch" | "idle"): void;
}

let state: ReminderState | null = null;
let view: ReminderView | null = null;
let timer: number | undefined;
let environment: ReminderEnvironment = {};
let shownId: string | null = null;
let mode: ModeState | null = null;
let alarmTimer: number | undefined;

function engineSettings(): ReminderSettings {
  const settings = store.settings;
  return { ...settings.reminders, offWork: settings.offWork };
}

function validState(candidate: ReminderState | null): candidate is ReminderState {
  return !!candidate && typeof candidate.date === "string" && !!candidate.stats &&
    typeof candidate.nextSedentaryAt === "number" && typeof candidate.nextWaterAt === "number" &&
    typeof candidate.nextEyeAt === "number" && typeof candidate.nextExerciseAt === "number";
}

function save(): void {
  if (!state) return;
  store.reminderRuntime = state;
  const all = store.reminderStats;
  all[state.date] = { ...state.stats };
  store.reminderStats = pruneDailyStats(all, localDateKey(Date.now()));
}

function syncView(previousId: string | null): void {
  if (!state || !view) return;
  const activeId = state.active?.id ?? null;
  if (previousId && !activeId) view.hide();
  if (activeId && activeId !== shownId) {
    const request = state.active!;
    view.show(request, request.kind === "eye" || request.kind === "exercise" ? specialReminderText(request.kind, request.healthIndex) : reminderText(request.healthIndex));
    if (store.settings.reminders.sound) playSoftSound();
  }
  shownId = activeId;
  void invoke("set_tray_pending", { pending: !!activeId }).catch(() => {});
  if (state.goalJustReached) {
    state.goalJustReached = false;
    view.goalReached();
  }
}

function playSoftSound(): void {
  try {
    const AudioContextClass = window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.025, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch { /* 提示音失败不能影响提醒 */ }
}

function canRing(): boolean {
  return !environment.meeting && !environment.fullscreen && !environment.bossHidden && !store.settings.meetingMode;
}

function clearLunchAlarm(): void { window.clearInterval(alarmTimer); alarmTimer = undefined; }

function ringLunchAlarm(): void {
  if (!store.settings.reminders.lunchAlarm) return;
  if (!canRing()) { if (state) { state.stats.missed += 1; save(); } return; }
  playSoftSound();
}

function beginLunchAlarm(): void {
  clearLunchAlarm();
  ringLunchAlarm();
  alarmTimer = window.setInterval(() => {
    if (!mode || mode.kind !== "lunch") return clearLunchAlarm();
    if (mode.alarmCount >= 3) {
      // 响满 3 次还没人确认：结束等待状态，否则其他提醒和待办会一直被「午休中」压住
      mode = null; clearLunchAlarm(); return;
    }
    mode = recordAlarm(mode);
    ringLunchAlarm();
  }, 30_000);
}

function pump(now = Date.now()): void {
  if (!state) return;
  if (mode) {
    if (mode.kind === "lunch" && mode.endsAt <= now && mode.alarmCount > 0) return;
    const transition = tickModeState(mode, now);
    mode = transition.state;
    if (!transition.event) return;
    if (transition.event === "focus-complete") {
      state.stats.focusSessions += 1;
      view?.modeMessage("专注完成啦，休息 5 分钟吧。", "idle");
      if (canRing() && store.settings.reminders.sound) playSoftSound();
      save();
      return;
    }
    if (transition.event === "lunch-complete") {
      // Keep the lunch state while the acknowledgement alarm is active.
      mode = { kind: "lunch", endsAt: now, alarmCount: 1 };
      view?.modeMessage("醒了，慢慢活动一下吧。", "idle");
      beginLunchAlarm();
      return;
    }
    view?.modeMessage("休息结束，慢慢继续吧。", "idle");
  }
  const beforeDate = state.date;
  const beforeStats = { ...state.stats };
  const previousId = state.active?.id ?? null;
  state = tickReminderState(state, now, engineSettings(), {
    ...environment,
    meeting: store.settings.meetingMode,
  });
  if (beforeDate !== state.date) {
    const stats = store.reminderStats;
    stats[beforeDate] = beforeStats;
    store.reminderStats = pruneDailyStats(stats, state.date);
  }
  save();
  syncView(previousId);
}

export function startReminderCenter(reminderView: ReminderView): void {
  view = reminderView;
  const now = Date.now();
  const saved = store.reminderRuntime;
  state = validState(saved) ? saved : createReminderState(now, engineSettings());
  window.clearInterval(timer);
  timer = window.setInterval(() => pump(), 15_000);
  pump(now);
}

export function stopReminderCenter(): void {
  window.clearInterval(timer);
  timer = undefined;
}

export function updateReminderEnvironment(next: Partial<ReminderEnvironment>): void {
  const becomingVisible = Object.entries(next).some(([key, value]) =>
    value === false && environment[key as keyof ReminderEnvironment] === true);
  if (becomingVisible) pump();
  environment = { ...environment, ...next };
  if (!becomingVisible) pump();
}

export function respondToReminder(action: ReminderAction): void {
  if (!state?.active) return;
  const previousId = state.active.id;
  state = acknowledgeReminder(state, action, Date.now(), engineSettings(), {
    ...environment,
    meeting: store.settings.meetingMode,
  });
  save();
  syncView(previousId);
}

export function startFocus(now = Date.now()): boolean {
  const next = beginMode(mode, "focus", now, store.settings.reminders.focusMinutes);
  if (!next) return false;
  mode = next;
  view?.modeMessage("专注开始，先把眼前这件事做好。", "focus");
  return true;
}

export function startLunch(now = Date.now(), minutes: number = store.settings.reminders.lunchMinutes): boolean {
  const next = beginMode(mode, "lunch", now, minutes);
  if (!next) return false;
  mode = next;
  view?.modeMessage("午休开始啦，安心歇一会儿。", "lunch");
  return true;
}

export function stopMode(): boolean {
  if (!mode) return false;
  const wasLunch = mode.kind === "lunch";
  mode = null; clearLunchAlarm();
  view?.modeMessage(wasLunch ? "午休提前结束啦。" : "已结束，辛苦了。", "idle");
  return true;
}

export function reminderMode(): { kind: "focus" | "break" | "lunch"; remainingMs: number } | null {
  return mode ? { kind: mode.kind, remainingMs: Math.max(0, mode.endsAt - Date.now()) } : null;
}

export function acknowledgeLunchAlarm(): boolean {
  if (!mode || mode.kind !== "lunch" || mode.endsAt > Date.now()) return false;
  mode = null; clearLunchAlarm();
  return true;
}

export function reopenPendingReminder(): boolean {
  if (!state?.active || !view) return false;
  view.show(state.active, reminderText(state.active.healthIndex));
  shownId = state.active.id;
  return true;
}

export function resetReminderSchedule(now = Date.now()): void {
  if (!state) return;
  const settings = engineSettings();
  state.nextSedentaryAt = now + settings.sedentaryMinutes * 60_000;
  state.nextWaterAt = now + settings.waterMinutes * 60_000;
  state.nextEyeAt = now + settings.eyeMinutes * 60_000;
  save();
  pump(now);
}

export function todayReminderStats() {
  if (state?.date === localDateKey(Date.now())) return { ...state.stats };
  return store.reminderStats[localDateKey(Date.now())] ?? { standUps: 0, waterCups: 0, eyeBreaks: 0, exercises: 0, focusSessions: 0, missed: 0 };
}

export function hasPendingReminder(): boolean {
  return !!state?.active;
}
