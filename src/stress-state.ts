export interface StressState { hits: number; startedAt: number; ended: boolean; }
export const STRESS_DURATION_MS = 30_000;

export function createStressState(now: number): StressState { return { hits: 0, startedAt: now, ended: false }; }
export function stressScale(hits: number): number { return Math.max(.35, 1 - hits * .03); }
export function stressFrame(hits: number): 1 | 2 | 3 | 4 | 5 {
  if (hits >= 25) return 5;
  if (hits > 14) return 4;
  return hits % 2 === 0 ? 1 : hits % 4 === 1 ? 2 : 3;
}
export function hitStress(state: StressState): StressState {
  const hits = Math.min(25, state.hits + 1);
  return { ...state, hits, ended: hits >= 25 };
}
export function stressExpired(state: StressState, now: number): boolean { return state.ended || now - state.startedAt >= STRESS_DURATION_MS; }

export function validateStressPhoto(file: Pick<File, "type" | "size">): string | null {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "请选择 PNG、JPG 或 WebP 图片。";
  if (file.size > 5 * 1024 * 1024) return "图片不能超过 5MB。";
  return null;
}
