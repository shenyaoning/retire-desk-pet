export type ReminderKind = "sedentary" | "water" | "eye" | "exercise";
export type ReminderAction = "done" | "later" | "mute-today";

export interface ReminderSettings {
  sedentaryEnabled: boolean;
  sedentaryMinutes: number;
  waterEnabled: boolean;
  waterGoal: number;
  waterMinutes: number;
  eyeEnabled: boolean;
  eyeMinutes: number;
  exerciseEnabled: boolean;
  exerciseGoal: number;
  exerciseMorning: string;
  exerciseAfternoon: string;
  activeFrom: string;
  activeTo: string;
  lunchFrom: string;
  lunchTo: string;
  offWork: string;
  hourlyLimit: number;
}

export interface ReminderEnvironment {
  meeting?: boolean;
  fullscreen?: boolean;
  bossHidden?: boolean;
}

export interface ReminderRequest {
  id: string;
  kind: ReminderKind;
  healthIndex: number;
}

export interface ReminderStats {
  standUps: number;
  waterCups: number;
  eyeBreaks: number;
  exercises: number;
  focusSessions: number;
  stressHits: number;
  missed: number;
}

export interface ReminderState {
  date: string;
  nextSedentaryAt: number;
  nextWaterAt: number;
  nextEyeAt: number;
  nextExerciseAt: number;
  active: ReminderRequest | null;
  queue: ReminderRequest[];
  mutedToday: Record<ReminderKind, boolean>;
  stats: ReminderStats;
  firedAt: number[];
  lastHealthIndex: number | null;
  goalJustReached: boolean;
}

const minute = 60_000;

export function localDateKey(now: number): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const minutesOfDay = (value: string): number => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

function within(value: number, startText: string, endText: string): boolean {
  const start = minutesOfDay(startText);
  const end = minutesOfDay(endText);
  if (start === end) return true;
  return start < end ? value >= start && value < end : value >= start || value < end;
}

export function isReminderQuiet(
  now: number,
  settings: ReminderSettings,
  environment: ReminderEnvironment,
): boolean {
  if (environment.meeting || environment.fullscreen || environment.bossHidden) return true;
  const date = new Date(now);
  const current = date.getHours() * 60 + date.getMinutes();
  if (!within(current, settings.activeFrom, settings.activeTo)) return true;
  if (within(current, settings.lunchFrom, settings.lunchTo)) return true;
  if (current >= minutesOfDay(settings.offWork)) return true;
  return false;
}

export function createReminderState(now: number, settings: ReminderSettings): ReminderState {
  return {
    date: localDateKey(now),
    nextSedentaryAt: now + settings.sedentaryMinutes * minute,
    nextWaterAt: now + settings.waterMinutes * minute,
    nextEyeAt: now + settings.eyeMinutes * minute,
    nextExerciseAt: nextExerciseTime(now, settings),
    active: null,
    queue: [],
    mutedToday: { sedentary: false, water: false, eye: false, exercise: false },
    stats: { standUps: 0, waterCups: 0, eyeBreaks: 0, exercises: 0, focusSessions: 0, stressHits: 0, missed: 0 },
    firedAt: [],
    lastHealthIndex: null,
    goalJustReached: false,
  };
}

function nextExerciseTime(now: number, settings: ReminderSettings): number {
  const date = new Date(now);
  const candidates = [settings.exerciseMorning, settings.exerciseAfternoon].map(value => {
    const [hours, minutes] = value.split(":").map(Number);
    const candidate = new Date(date); candidate.setHours(hours, minutes, 0, 0); return candidate.getTime();
  });
  return candidates.find(value => value > now) ?? candidates[0] + 24 * 60 * minute;
}

function resetForNewDay(state: ReminderState, now: number, settings: ReminderSettings): ReminderState {
  const reset = createReminderState(now, settings);
  return { ...reset, lastHealthIndex: state.lastHealthIndex };
}

function chooseHealthIndex(previous: number | null, random: () => number): number {
  let next = 1 + Math.floor(Math.min(0.999999, Math.max(0, random())) * 16);
  if (previous != null && next === previous) next = next % 16 + 1;
  return next;
}

function requestFor(kind: ReminderKind, state: ReminderState, now: number, random: () => number): ReminderRequest {
  const healthIndex = kind === "water" ? 13 : kind === "eye" ? 12 : kind === "exercise" ? chooseHealthIndex(state.lastHealthIndex, random) : chooseHealthIndex(state.lastHealthIndex, random);
  return { id: `${kind}-${now}`, kind, healthIndex };
}

function isEnabled(kind: ReminderKind, state: ReminderState, settings: ReminderSettings): boolean {
  if (kind === "sedentary") return settings.sedentaryEnabled && !state.mutedToday.sedentary;
  if (kind === "water") return settings.waterEnabled && !state.mutedToday.water && state.stats.waterCups < settings.waterGoal;
  if (kind === "eye") return settings.eyeEnabled && !state.mutedToday.eye;
  return settings.exerciseEnabled && !state.mutedToday.exercise && state.stats.exercises < settings.exerciseGoal;
}

function nextAt(state: ReminderState, kind: ReminderKind): number {
  return kind === "sedentary" ? state.nextSedentaryAt : kind === "water" ? state.nextWaterAt : kind === "eye" ? state.nextEyeAt : state.nextExerciseAt;
}

function advance(state: ReminderState, kind: ReminderKind, now: number, settings: ReminderSettings): void {
  if (kind === "sedentary") state.nextSedentaryAt = now + settings.sedentaryMinutes * minute;
  else if (kind === "water") state.nextWaterAt = now + settings.waterMinutes * minute;
  else if (kind === "eye") state.nextEyeAt = now + settings.eyeMinutes * minute;
  else state.nextExerciseAt = nextExerciseTime(now, settings);
}

function promote(state: ReminderState, now: number, settings: ReminderSettings): void {
  if (state.active || state.queue.length === 0) return;
  state.firedAt = state.firedAt.filter(time => now - time < 60 * minute);
  if (state.firedAt.length >= settings.hourlyLimit) {
    state.stats.missed += state.queue.length;
    state.queue = [];
    return;
  }
  state.active = state.queue.shift() ?? null;
  if (state.active) state.firedAt.push(now);
}

export function tickReminderState(
  input: ReminderState,
  now: number,
  settings: ReminderSettings,
  environment: ReminderEnvironment,
  random: () => number = Math.random,
): ReminderState {
  let state = structuredClone(input);
  if (state.date !== localDateKey(now)) state = resetForNewDay(state, now, settings);
  state.goalJustReached = false;
  state.firedAt = state.firedAt.filter(time => now - time < 60 * minute);
  if (state.active && !isEnabled(state.active.kind, state, settings)) state.active = null;
  state.queue = state.queue.filter(request => isEnabled(request.kind, state, settings));
  if (isReminderQuiet(now, settings, environment) && (state.active || state.queue.length > 0)) {
    state.stats.missed += (state.active ? 1 : 0) + state.queue.length;
    state.active = null;
    state.queue = [];
  }

  for (const kind of ["sedentary", "water", "eye", "exercise"] as const) {
    if (now < nextAt(state, kind)) continue;
    if (!isEnabled(kind, state, settings)) {
      advance(state, kind, now, settings);
      continue;
    }
    if (state.active?.kind === kind || state.queue.some(request => request.kind === kind)) {
      advance(state, kind, now, settings);
      continue;
    }
    if (isReminderQuiet(now, settings, environment) ||
        (!state.active && state.queue.length === 0 && state.firedAt.length >= settings.hourlyLimit)) {
      state.stats.missed += 1;
      advance(state, kind, now, settings);
      continue;
    }
    const request = requestFor(kind, state, now, random);
    if (kind === "sedentary" || kind === "exercise") state.lastHealthIndex = request.healthIndex;
    state.queue.push(request);
    advance(state, kind, now, settings);
    promote(state, now, settings);
  }
  return state;
}

export function acknowledgeReminder(
  input: ReminderState,
  action: ReminderAction,
  now: number,
  settings: ReminderSettings,
  environment: ReminderEnvironment = {},
): ReminderState {
  const state = structuredClone(input);
  const request = state.active;
  if (!request) return state;
  state.active = null;
  state.goalJustReached = false;

  if (action === "later") {
    if (request.kind === "sedentary") state.nextSedentaryAt = now + 10 * minute;
    else if (request.kind === "water") state.nextWaterAt = now + 10 * minute;
    else if (request.kind === "eye") state.nextEyeAt = now + 5 * minute;
    else state.nextExerciseAt = now + 10 * minute;
  } else if (action === "mute-today") {
    state.mutedToday[request.kind] = true;
  } else if (request.kind === "sedentary") {
    state.stats.standUps += 1;
    state.nextSedentaryAt = now + settings.sedentaryMinutes * minute;
  } else if (request.kind === "water") {
    state.stats.waterCups = Math.min(settings.waterGoal, state.stats.waterCups + 1);
    state.nextWaterAt = now + settings.waterMinutes * minute;
    state.goalJustReached = state.stats.waterCups >= settings.waterGoal;
  } else if (request.kind === "eye") {
    state.stats.eyeBreaks += 1;
    state.nextEyeAt = now + settings.eyeMinutes * minute;
  } else {
    state.stats.exercises = Math.min(settings.exerciseGoal, state.stats.exercises + 1);
    state.nextExerciseAt = nextExerciseTime(now, settings);
  }

  if (isReminderQuiet(now, settings, environment)) {
    state.stats.missed += state.queue.length;
    state.queue = [];
  } else {
    promote(state, now, settings);
  }
  return state;
}
