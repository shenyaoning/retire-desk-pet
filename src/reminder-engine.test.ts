import { describe, expect, it } from "vitest";
import {
  acknowledgeReminder,
  createReminderState,
  tickReminderState,
  type ReminderSettings,
} from "./reminder-engine";

const settings: ReminderSettings = {
  sedentaryEnabled: true,
  sedentaryMinutes: 60,
  waterEnabled: true,
  waterGoal: 8,
  waterMinutes: 90,
  eyeEnabled: false,
  eyeMinutes: 20,
  exerciseEnabled: false,
  exerciseGoal: 3,
  exerciseMorning: "10:30",
  exerciseAfternoon: "15:30",
  activeFrom: "09:00",
  activeTo: "17:30",
  lunchFrom: "12:00",
  lunchTo: "14:00",
  offWork: "17:30",
  hourlyLimit: 3,
};

const at = (text: string) => new Date(`2026-10-08T${text}:00`).getTime();

describe("reminder scheduler", () => {
  it("fires sedentary from startup interval and queues water behind it", () => {
    const enabled = { ...settings, exerciseEnabled: true };
    let state = createReminderState(at("09:00"), enabled);
    state.nextSedentaryAt = at("10:00");
    state.nextWaterAt = at("10:00");
    state = tickReminderState(state, at("10:00"), enabled, {});
    expect(state.active?.kind).toBe("sedentary");
    expect(state.queue.map(item => item.kind)).toEqual(["water"]);
  });

  it("keeps a collapsed reminder pending until the user answers it", () => {
    let state = createReminderState(at("09:00"), settings);
    state.nextSedentaryAt = at("10:00");
    state = tickReminderState(state, at("10:00"), settings, {});
    const pendingId = state.active?.id;
    state = tickReminderState(state, at("10:08"), settings, {});
    expect(state.active?.id).toBe(pendingId);
  });

  it("does not stack another reminder of the same kind while one is pending", () => {
    let state = createReminderState(at("09:00"), settings);
    state.nextSedentaryAt = at("10:00");
    state.nextWaterAt = at("23:59");
    state = tickReminderState(state, at("10:00"), settings, {});
    state = tickReminderState(state, at("11:00"), settings, {});
    expect(state.active?.kind).toBe("sedentary");
    expect(state.queue.filter(item => item.kind === "sedentary")).toHaveLength(0);
  });

  it("does not choose the same random sedentary sticker twice in a row", () => {
    let state = createReminderState(at("09:00"), settings);
    state.lastHealthIndex = 5;
    state.nextSedentaryAt = at("10:00");
    state = tickReminderState(state, at("10:00"), settings, {}, () => 0.26);
    expect(state.active?.healthIndex).toBe(6);
  });

  it("snoozes exactly ten minutes", () => {
    let state = createReminderState(at("09:00"), settings);
    state.nextSedentaryAt = at("10:00");
    state = tickReminderState(state, at("10:00"), settings, {});
    state = acknowledgeReminder(state, "later", at("10:01"), settings);
    expect(state.nextSedentaryAt).toBe(at("10:11"));
    state = tickReminderState(state, at("10:10"), settings, {});
    expect(state.active).toBeNull();
    state = tickReminderState(state, at("10:11"), settings, {});
    expect(state.active?.kind).toBe("sedentary");
  });

  it("mutes only the selected kind for the rest of today", () => {
    let state = createReminderState(at("09:00"), settings);
    state.nextSedentaryAt = at("10:00");
    state = tickReminderState(state, at("10:00"), settings, {});
    state = acknowledgeReminder(state, "mute-today", at("10:01"), settings);
    state.nextSedentaryAt = at("10:02");
    state.nextWaterAt = at("10:02");
    state = tickReminderState(state, at("10:02"), settings, {});
    expect(state.active?.kind).toBe("water");
    expect(state.mutedToday.sedentary).toBe(true);
  });

  it("clears a pending kind when its reminder switch is turned off", () => {
    let state = createReminderState(at("09:00"), settings);
    state.nextSedentaryAt = at("10:00");
    state = tickReminderState(state, at("10:00"), settings, {});
    state = tickReminderState(state, at("10:01"), { ...settings, sedentaryEnabled: false }, {});
    expect(state.active).toBeNull();
    expect(state.stats.missed).toBe(0);
  });

  it("does not promote a queued reminder after meeting mode starts", () => {
    let state = createReminderState(at("09:00"), settings);
    state.nextSedentaryAt = at("10:00");
    state.nextWaterAt = at("10:00");
    state = tickReminderState(state, at("10:00"), settings, {});
    state = acknowledgeReminder(state, "done", at("10:01"), settings, { meeting: true });
    expect(state.active).toBeNull();
    expect(state.queue).toEqual([]);
    expect(state.stats.missed).toBe(1);
  });

  it("dismisses an active reminder when meeting mode starts", () => {
    let state = createReminderState(at("09:00"), settings);
    state.nextSedentaryAt = at("10:00");
    state = tickReminderState(state, at("10:00"), settings, {});
    expect(state.active?.kind).toBe("sedentary");
    state = tickReminderState(state, at("10:01"), settings, { meeting: true });
    expect(state.active).toBeNull();
    expect(state.stats.missed).toBe(1);
  });

  it.each([
    ["meeting", { meeting: true }],
    ["fullscreen", { fullscreen: true }],
    ["boss hidden", { bossHidden: true }],
  ])("silences due reminders during %s and records them as missed", (_name, env) => {
    let state = createReminderState(at("09:00"), settings);
    state.nextSedentaryAt = at("10:00");
    state = tickReminderState(state, at("10:00"), settings, env);
    expect(state.active).toBeNull();
    expect(state.stats.missed).toBe(1);
    expect(state.nextSedentaryAt).toBe(at("11:00"));
  });

  it.each(["08:59", "12:30", "17:31"])("silences health reminders at %s", (time) => {
    let state = createReminderState(at("08:00"), settings);
    state.nextSedentaryAt = at(time);
    state.nextWaterAt = at("23:59");
    state = tickReminderState(state, at(time), settings, {});
    expect(state.active).toBeNull();
    expect(state.stats.missed).toBe(1);
  });

  it("enforces the per-hour firing limit", () => {
    let state = createReminderState(at("09:00"), settings);
    state.firedAt = [at("10:01"), at("10:10"), at("10:20")];
    state.nextSedentaryAt = at("23:59");
    state.nextWaterAt = at("10:30");
    state = tickReminderState(state, at("10:30"), settings, {});
    expect(state.active).toBeNull();
    expect(state.stats.missed).toBe(1);
  });

  it("resets daily counters, mute flags, and firing history on the next day", () => {
    let state = createReminderState(at("09:00"), settings);
    state.stats = { standUps: 4, waterCups: 7, eyeBreaks: 2, exercises: 1, focusSessions: 1, missed: 2 };
    state.mutedToday = { sedentary: true, water: true, eye: true, exercise: true };
    state.firedAt = [at("16:00")];
    state = tickReminderState(state, new Date("2026-10-09T09:00:00").getTime(), settings, {});
    expect(state.stats).toEqual({ standUps: 0, waterCups: 0, eyeBreaks: 0, exercises: 0, focusSessions: 0, missed: 0 });
    expect(state.mutedToday).toEqual({ sedentary: false, water: false, eye: false, exercise: false });
    expect(state.firedAt).toEqual([]);
  });
});

describe("water and completion accounting", () => {
  it("counts stand-up completion and restarts its interval from completion", () => {
    let state = createReminderState(at("09:00"), settings);
    state.nextSedentaryAt = at("10:00");
    state = tickReminderState(state, at("10:00"), settings, {});
    state = acknowledgeReminder(state, "done", at("10:03"), settings);
    expect(state.stats.standUps).toBe(1);
    expect(state.nextSedentaryAt).toBe(at("11:03"));
  });

  it("counts water, announces goal, and stops water reminders after reaching it", () => {
    const goalSettings = { ...settings, waterGoal: 2 };
    let state = createReminderState(at("09:00"), goalSettings);
    state.stats.waterCups = 1;
    state.nextSedentaryAt = at("23:59");
    state.nextWaterAt = at("10:00");
    state = tickReminderState(state, at("10:00"), goalSettings, {});
    state = acknowledgeReminder(state, "done", at("10:01"), goalSettings);
    expect(state.stats.waterCups).toBe(2);
    expect(state.goalJustReached).toBe(true);
    state.nextWaterAt = at("10:02");
    state = tickReminderState(state, at("10:02"), goalSettings, {});
    expect(state.active).toBeNull();
  });
});

describe("eye and exercise reminders", () => {
  it("fires an enabled eye reminder and snoozes it for five minutes", () => {
    const enabled = { ...settings, eyeEnabled: true };
    let state = createReminderState(at("09:00"), enabled);
    state.nextSedentaryAt = at("23:59"); state.nextWaterAt = at("23:59"); state.nextExerciseAt = at("23:59"); state.nextEyeAt = at("10:00");
    state = tickReminderState(state, at("10:00"), enabled, {});
    expect(state.active?.kind).toBe("eye");
    state = acknowledgeReminder(state, "later", at("10:01"), enabled);
    expect(state.nextEyeAt).toBe(at("10:06"));
  });

  it("counts exercise and uses its daily goal", () => {
    const enabled = { ...settings, exerciseEnabled: true };
    let state = createReminderState(at("09:00"), enabled);
    state.nextSedentaryAt = at("23:59"); state.nextWaterAt = at("23:59"); state.nextEyeAt = at("23:59"); state.nextExerciseAt = at("10:00");
    state = tickReminderState(state, at("10:00"), enabled, {});
    expect(state.active?.kind).toBe("exercise");
    state = acknowledgeReminder(state, "done", at("10:01"), enabled);
    expect(state.stats.exercises).toBe(1);
  });
});
