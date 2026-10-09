/** 本地存储：全部数据只存本机 localStorage。 */
import { LINES_DEFAULT, type LinesConfig } from "./lines-service";
import type { ReminderState, ReminderStats } from "./reminder-engine";
import type { Todo } from "./todo-service";

export interface Profile {
  birthYm: string;        // "YYYY-MM"
  birthDay?: number;
  category: "male" | "female55" | "female50";
  joinYm?: string;
}

export interface Settings {
  scale: 2 | 3 | 4;
  offWork: string;        // "17:30"
  payday: number;
  showBubble: boolean;
  showBadge: boolean;
  avoidFullscreen: boolean;
  meetingMode: boolean;
  skin: string;
  shareStandups?: boolean;
  animations?: boolean;   // 逐帧动画，默认关（静态表情更流畅）
  bossKey?: string;       // 未设置时用默认键
  reminders: ReminderPreferences;
}

export interface ReminderPreferences {
  sedentaryEnabled: boolean;
  sedentaryMinutes: 45 | 60 | 90;
  waterEnabled: boolean;
  waterGoal: number;
  waterMinutes: number;
  eyeEnabled: boolean;
  eyeMinutes: 20 | 30 | 45;
  exerciseEnabled: boolean;
  exerciseGoal: number;
  exerciseMorning: string;
  exerciseAfternoon: string;
  focusMinutes: 15 | 25 | 45;
  lunchMinutes: 20 | 30 | 45 | 60;
  lunchAlarm: boolean;
  lunchWakeTime: string;
  activeFrom: string;
  activeTo: string;
  lunchFrom: string;
  lunchTo: string;
  hourlyLimit: number;
  sound: boolean;
}

const KEY = "rdp.v1.";

export const defaults: { profile: Profile; settings: Settings } = {
  profile: { birthYm: "", category: "male" },
  settings: {
    scale: 3,
    offWork: "17:30",
    payday: 15,
    showBubble: true,
    showBadge: true,
    avoidFullscreen: true,
    meetingMode: false,
    skin: "default",
    shareStandups: false,
    animations: false,
    reminders: {
      sedentaryEnabled: true,
      sedentaryMinutes: 60,
      waterEnabled: true,
      waterGoal: 8,
      waterMinutes: 90,
      eyeEnabled: false,
      eyeMinutes: 20,
      exerciseEnabled: true,
      exerciseGoal: 3,
      exerciseMorning: "10:30",
      exerciseAfternoon: "15:30",
      focusMinutes: 25,
      lunchMinutes: 30,
      lunchAlarm: true,
      lunchWakeTime: "13:30",
      activeFrom: "09:00",
      activeTo: "17:30",
      lunchFrom: "12:00",
      lunchTo: "14:00",
      hourlyLimit: 3,
      sound: false,
    },
  },
};

function read<T>(k: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(KEY + k);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
}

function write(k: string, v: unknown) {
  localStorage.setItem(KEY + k, JSON.stringify(v));
}

export const store = {
  get profile() { return read("profile", defaults.profile); },
  set profile(v: Profile) { write("profile", v); },
  get settings() {
    const saved = read("settings", defaults.settings);
    return { ...saved, reminders: { ...defaults.settings.reminders, ...saved.reminders } };
  },
  set settings(v: Settings) { write("settings", v); },
  get windowPos(): { x: number; y: number } | null {
    try {
      const raw = localStorage.getItem(KEY + "winpos");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  set windowPos(v: { x: number; y: number } | null) {
    if (v) write("winpos", v); else localStorage.removeItem(KEY + "winpos");
  },
  get mode(): string { return localStorage.getItem(KEY + "mode") ?? "pet"; },
  set mode(v: string) { localStorage.setItem(KEY + "mode", v); },
  get linesCfg(): LinesConfig { return read("lines", LINES_DEFAULT); },
  set linesCfg(v: LinesConfig) { write("lines", v); },
  get reminderRuntime(): ReminderState | null {
    try {
      const raw = localStorage.getItem(KEY + "reminder-runtime");
      return raw ? JSON.parse(raw) as ReminderState : null;
    } catch { return null; }
  },
  set reminderRuntime(v: ReminderState | null) {
    if (v) write("reminder-runtime", v); else localStorage.removeItem(KEY + "reminder-runtime");
  },
  get reminderStats(): Record<string, ReminderStats> {
    try {
      const raw = localStorage.getItem(KEY + "reminder-stats");
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  },
  set reminderStats(v: Record<string, ReminderStats>) { write("reminder-stats", v); },
  get todos(): Todo[] {
    try {
      const raw = localStorage.getItem(KEY + "todos");
      return raw && Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) as Todo[] : [];
    } catch { return []; }
  },
  set todos(v: Todo[]) { write("todos", v); },
  get dailySummaryShown(): string | null { return localStorage.getItem(KEY + "daily-summary-shown"); },
  set dailySummaryShown(v: string | null) {
    if (v) localStorage.setItem(KEY + "daily-summary-shown", v);
    else localStorage.removeItem(KEY + "daily-summary-shown");
  },
  get milestones(): Record<string, true> {
    try {
      const raw = localStorage.getItem(KEY + "milestones");
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  },
  fireMilestone(id: string) {
    const m = store.milestones;
    m[id] = true;
    write("milestones", m);
  },
  clearAll() {
    Object.keys(localStorage).filter(k => k.startsWith(KEY)).forEach(k => localStorage.removeItem(k));
  },
  get ready() { return !!store.profile.birthYm; },
};
