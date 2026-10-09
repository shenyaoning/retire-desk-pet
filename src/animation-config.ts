import type { PlaybackMode } from "./animation-player";

export interface EventAnimationConfig {
  mode: PlaybackMode;
  durationMs: number;
}

export const EVENT_ANIMATIONS: Readonly<Record<string, EventAnimationConfig>> = {
  "mood-02": { mode: "once", durationMs: 2550 },
  "mood-07": { mode: "once", durationMs: 1230 },
  "mood-09": { mode: "once", durationMs: 1570 },
  "mood-10": { mode: "once", durationMs: 1320 },
  "mood-11": { mode: "once", durationMs: 1300 },
  "mood-12": { mode: "loop", durationMs: 3000 },
  "mood-13": { mode: "loop", durationMs: 0 },
  "mood-14": { mode: "once", durationMs: 1300 },
  "mood-15": { mode: "once", durationMs: 1300 },
  "mood-16": { mode: "loop", durationMs: 4000 },
};

export interface BaseAnimationPlan {
  key: string;
  id: string;
  mode: PlaybackMode;
  repeatAfterMs?: readonly [number, number];
  oncePerDay?: boolean;
  animated: boolean;
}

interface TimeRule extends BaseAnimationPlan {
  from: number;
  to: number;
  weekday?: number;
}

const TIME_ANIMATION_RULES: readonly TimeRule[] = [
  { key: "friday", id: "mood-08", mode: "once", repeatAfterMs: [5 * 60_000, 10 * 60_000], animated: true, weekday: 5, from: 14 * 60, to: 24 * 60 },
  { key: "morning", id: "mood-03", mode: "once", repeatAfterMs: [30_000, 60_000], animated: true, from: 8 * 60, to: 9 * 60 },
  { key: "lunch", id: "mood-04", mode: "loop", animated: true, from: 11 * 60 + 20, to: 12 * 60 },
  { key: "afternoon", id: "mood-05", mode: "once", repeatAfterMs: [20_000, 60_000], animated: true, from: 14 * 60 + 30, to: 15 * 60 + 30 },
  { key: "offwork", id: "mood-07", mode: "once", oncePerDay: true, animated: true, from: 17 * 60 + 20, to: 24 * 60 },
];

const IDLE_PLAN: BaseAnimationPlan = {
  key: "idle",
  id: "mood-01",
  mode: "once",
  repeatAfterMs: [3000, 6000],
  animated: true,
};

const MEETING_PLAN: BaseAnimationPlan = {
  key: "meeting",
  id: "mood-06",
  mode: "loop",
  animated: false,
};

export function baseAnimationPlan(now: Date, meeting: boolean): BaseAnimationPlan {
  if (meeting) return MEETING_PLAN;
  const minute = now.getHours() * 60 + now.getMinutes();
  return TIME_ANIMATION_RULES.find(rule =>
    (rule.weekday === undefined || rule.weekday === now.getDay())
    && minute >= rule.from
    && minute < rule.to,
  ) ?? IDLE_PLAN;
}

export function randomDelay(range: readonly [number, number], random = Math.random): number {
  return Math.round(range[0] + random() * (range[1] - range[0]));
}

export function dayKey(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}
