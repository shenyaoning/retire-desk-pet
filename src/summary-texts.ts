import type { SummaryBand } from "./summary-service";

export const SUMMARY_TEXTS: Record<SummaryBand, readonly string[]> = {
  low: ["今天先歇一歇，明天再拾起来。", "待办还在，慢慢来也算前进。", "收工吧，给自己留点力气。"],
  mid: ["今天完成了一部分，已经很不错。", "稳稳当当做完这些，辛苦啦。", "下班时间到，剩下的明天继续。"],
  high: ["今天的待办全拿下了，漂亮！", "收工收工，给自己记一朵小红花。", "效率满格，今晚安心休息。"],
};

export function summaryText(band: SummaryBand, seed = new Date().getDate()): string {
  const texts = SUMMARY_TEXTS[band];
  return texts[Math.abs(seed) % texts.length];
}
