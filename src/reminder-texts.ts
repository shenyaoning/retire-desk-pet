export const REMINDER_TEXTS = [
  "坐太久啦，起来走两分钟",
  "双手举高，伸个大大的懒腰",
  "慢慢转脖子，左右各 5 次",
  "双手叉腰，左右各扭 10 下",
  "放松肩膀，甩甩手臂 20 下",
  "原地踏步 1 分钟，活动活动腿",
  "慢慢做 10 个深蹲，量力而行",
  "站起来靠一靠，放松一下腰背",
  "轻轻拉伸大腿，每侧 20 秒",
  "闭上眼睛，轻揉眼眶一圈",
  "看看远处，让眼睛休息 20 秒",
  "深吸一口气，慢慢呼出来，做 5 次",
  "喝几口水吧",
  "去爬两层楼梯吧",
  "饭后慢慢走一走，10 分钟就好",
  "收拾收拾，该回家啦",
] as const;

export const EYE_REMINDER_TEXTS = [
  "看看远处，让眼睛休息 20 秒",
  "抬头望望窗外，给眼睛换个焦点",
  "先离开屏幕一会儿，看看远处",
  "眨眨眼，望向远一点的地方",
  "把目光放远 20 秒，再继续",
  "屏幕先放一放，看看远处吧",
] as const;

export const EXERCISE_REMINDER_TEXTS = [
  "双手举高，伸个大大的懒腰",
  "慢慢转脖子，左右各 5 次",
  "双手叉腰，左右各扭 10 下",
  "放松肩膀，甩甩手臂 20 下",
  "慢慢做 10 个深蹲，量力而行",
  "轻轻拉伸大腿，每侧 20 秒",
] as const;

export const FOCUS_TEXTS = [
  "专注时间开始，先把这一件事做好。",
  "专注一会儿，其他事稍后再说。",
  "这一段时间留给眼前的任务。",
  "安静做一会儿，慢慢推进就好。",
  "先专心，完成这一小步。",
  "把注意力收回来，继续做吧。",
] as const;

export const LUNCH_TEXTS = [
  "午休开始啦，安心歇一会儿。",
  "先放下手边的事，休息一下。",
  "午间留点安静时间给自己。",
  "休息一会儿，下午再继续。",
  "午休时间到，慢慢放松吧。",
  "先歇一歇，醒来再忙。",
] as const;

export function specialReminderText(kind: "eye" | "exercise", healthIndex = 1): string {
  if (kind === "eye") return EYE_REMINDER_TEXTS[healthIndex % EYE_REMINDER_TEXTS.length];
  return EXERCISE_REMINDER_TEXTS[(healthIndex - 1) % EXERCISE_REMINDER_TEXTS.length];
}

export function reminderText(healthIndex: number): string {
  return REMINDER_TEXTS[healthIndex - 1] ?? REMINDER_TEXTS[0];
}
