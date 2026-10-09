/** Priority and schedule rules for the sticker state machine. */
export const TIME_RULES = [
  { id: "mood-08", weekday: 5, from: "14:00", to: "24:00" },
  { id: "mood-03", from: "08:00", to: "09:00" },
  { id: "mood-04", from: "11:20", to: "12:00" },
  { id: "mood-05", from: "14:30", to: "15:30" },
  { id: "mood-07", from: "17:20", to: "24:00" },
] as const;

export const EVENT_RULES = {
  tea: { id: "mood-02", duration: 5000 },
  poke: { id: "mood-09", duration: 1200 },
  angry: { id: "mood-12", duration: 3000 },
  drag: { id: "mood-13", duration: 0 },
  sign: { id: "mood-16", duration: 4000 },
  complete: { id: "mood-11", duration: 2000 },
  allComplete: { id: "mood-14", duration: 2000 },
  overdue: { id: "mood-10", duration: 2000 },
  milestone: { id: "mood-15", duration: 2000 },
} as const;

const minutes = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

export function scheduledSticker(now: Date, meeting: boolean): string {
  if (meeting) return "mood-06";
  const time = now.getHours() * 60 + now.getMinutes();
  for (const rule of TIME_RULES) {
    if ("weekday" in rule && now.getDay() !== rule.weekday) continue;
    if (time >= minutes(rule.from) && time < minutes(rule.to)) return rule.id;
  }
  return "mood-01";
}

export function stickerWithReminderPriority(
  reminder: string | null,
  temporary: string | null,
  scheduled: string,
): string {
  return reminder ?? temporary ?? scheduled;
}

export function recordClick(clicks: number[], now: number): { clicks: number[]; angry: boolean } {
  const next = [...clicks.filter(time => now - time <= 3000), now];
  return { clicks: next, angry: next.length >= 5 };
}
