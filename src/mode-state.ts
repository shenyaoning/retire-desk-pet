export type ModeKind = "focus" | "break" | "lunch";

export interface ModeState {
  kind: ModeKind;
  endsAt: number;
  alarmCount: number;
}

export type ModeEvent = "focus-complete" | "break-complete" | "lunch-complete" | null;

export function beginMode(current: ModeState | null, kind: Exclude<ModeKind, "break">, now: number, minutes: number): ModeState | null {
  if (current) return null;
  return { kind, endsAt: now + minutes * 60_000, alarmCount: 0 };
}

export function stopModeState(current: ModeState | null): ModeState | null { return current ? null : current; }

export function tickModeState(current: ModeState | null, now: number): { state: ModeState | null; event: ModeEvent } {
  if (!current || now < current.endsAt) return { state: current, event: null };
  if (current.kind === "focus") return { state: { kind: "break", endsAt: now + 5 * 60_000, alarmCount: 0 }, event: "focus-complete" };
  return { state: null, event: current.kind === "break" ? "break-complete" : "lunch-complete" };
}

export function recordAlarm(current: ModeState | null): ModeState | null {
  return current && current.kind === "lunch" && current.alarmCount < 3 ? { ...current, alarmCount: current.alarmCount + 1 } : current;
}
