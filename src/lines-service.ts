/**
 * 台词抽取与自定义台词的纯逻辑（无 DOM、无全局状态，可单测）。
 * 模式：mix=内置+我的（我的权重×3）；custom_only=只用我的（空则回退 mix 并提示）；builtin_only=只用内置。
 * 关闭的内置台词以文本记录；场景无可用台词回退「平时」组。
 */
import { lines, SCENE_KEYS, type SceneKey } from "./lines";
export type { SceneKey };

export type LinesMode = "mix" | "custom_only" | "builtin_only";

export interface CustomLine {
  id: string;
  scene: SceneKey;
  text: string;
}

export interface LinesConfig {
  custom: CustomLine[];
  /** 被关掉的内置台词文本 */
  disabledBuiltin: string[];
  mode: LinesMode;
}

export const LINES_DEFAULT: LinesConfig = { custom: [], disabledBuiltin: [], mode: "mix" };

export const MAX_LINE_LEN = 30;
export const MAX_CUSTOM_LINES = 100;

export function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 添加校验：返回错误消息，null = 通过 */
export function validateCustomLine(
  text: string, scene: SceneKey, existing: CustomLine[],
): string | null {
  if (!text.trim()) return "台词不能是空白";
  if (text.length > MAX_LINE_LEN) return `超出 ${text.length - MAX_LINE_LEN} 个字（上限 30 字，含标点）`;
  if (existing.some(l => l.text === text)) return "这条已经在列表里了";
  if (!SCENE_KEYS.includes(scene)) return "场景不对";
  return null;
}

export interface PickOptions {
  nearRetire?: boolean;
  rng?: () => number;
}

export interface PickResult {
  text: string;
  source: "builtin" | "custom";
  /** 仅 custom_only 且一条自定义都没有时出现 */
  fallbackReason?: string;
}

function enabledBuiltin(scene: SceneKey, cfg: LinesConfig): string[] {
  return lines[scene].filter(t => !cfg.disabledBuiltin.includes(t));
}

/** 内置池：临近退休时平时场景在 general/retire 两组间各占一半概率（组级掷签，组空换另一组） */
function builtinPool(scene: SceneKey, cfg: LinesConfig, nearRetire: boolean, rng: () => number): string[] {
  const pool = enabledBuiltin(scene, cfg);
  if (nearRetire && scene === "general") {
    const retire = enabledBuiltin("retire", cfg);
    const wantRetire = rng() < 0.5;
    const chosen = wantRetire ? retire : pool;
    return chosen.length > 0 ? chosen : (wantRetire ? pool : retire);
  }
  return pool;
}

function customPool(scene: SceneKey, cfg: LinesConfig): CustomLine[] {
  return cfg.custom.filter(l => l.scene === scene);
}

function pickFrom(
  mode: LinesMode, scene: SceneKey, cfg: LinesConfig, nearRetire: boolean, rng: () => number,
): PickResult | null {
  const b = builtinPool(scene, cfg, nearRetire, rng);
  const c = customPool(scene, cfg);

  if (mode === "custom_only") {
    if (c.length === 0) return null;
    return { text: c[Math.floor(rng() * c.length)].text, source: "custom" };
  }
  if (mode === "builtin_only") {
    if (b.length === 0) return null;
    return { text: b[Math.floor(rng() * b.length)], source: "builtin" };
  }
  // mix：我的台词权重 ×3
  const total = b.length + c.length * 3;
  if (total === 0) return null;
  const r = rng() * total;
  if (r < b.length) {
    return { text: b[Math.floor(rng() * b.length)], source: "builtin" };
  }
  const picked = c[Math.floor(rng() * c.length)];
  return { text: picked.text, source: "custom" };
}

/** 抽一条台词。scene=当前场景；场景池空回退「平时」；custom_only 全空回退 mix 并带提示 */
export function pickLine(cfg: LinesConfig, scene: SceneKey, opts: PickOptions = {}): PickResult {
  const rng = opts.rng ?? Math.random;
  const nearRetire = opts.nearRetire ?? false;

  let result = pickFrom(cfg.mode, scene, cfg, nearRetire, rng);
  if (!result && scene !== "general") {
    result = pickFrom(cfg.mode, "general", cfg, nearRetire, rng);
  }
  if (!result && cfg.mode === "custom_only") {
    result = pickFrom("mix", scene !== "general" ? "general" : scene, cfg, nearRetire, rng);
    if (result) result.fallbackReason = "「我的台词」是空的，这次按混合模式抽了";
  }
  if (!result) result = { text: "……", source: "builtin" };
  return result;
}

/** {days} 替换 */
export function renderLine(text: string, days: number | null): string {
  if (days == null) return text.replace(/\{days\}/g, "?");
  return text.replace(/\{days\}/g, String(days));
}

/* ---------------- 导入 / 导出 ---------------- */

export interface ImportReport {
  added: number;
  duplicate: number;
  /** badType=-1 表示整个文件不是合法 JSON / 缺 lines 数组 */
  rejected: { badType: number; tooLong: number; empty: number; badScene: number; overLimit: number };
}

export function exportLines(cfg: LinesConfig): string {
  return JSON.stringify({
    app: "retire-desk-pet",
    type: "custom-lines",
    version: 1,
    exportedAt: new Date().toISOString(),
    lines: cfg.custom.map(l => ({ scene: l.scene, text: l.text })),
  }, null, 2);
}

/** 解析导入内容；永不抛异常，一切问题都在 report 里 */
export function importLines(raw: string, existing: CustomLine[]): { config: CustomLine[]; report: ImportReport } {
  const report: ImportReport = {
    added: 0, duplicate: 0,
    rejected: { badType: 0, tooLong: 0, empty: 0, badScene: 0, overLimit: 0 },
  };
  const merged = [...existing];
  const fail = () => ({ config: merged, report: { ...report, rejected: { ...report.rejected, badType: -1 } } });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail();
  }

  let items: unknown;
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { lines?: unknown }).lines)) {
    items = (parsed as { lines: unknown }).lines;
  } else {
    return fail();
  }

  for (const item of items as unknown[]) {
    if (merged.length >= MAX_CUSTOM_LINES) { report.rejected.overLimit++; continue; }
    if (!item || typeof item !== "object") { report.rejected.badType++; continue; }
    const { scene, text } = item as { scene?: unknown; text?: unknown };
    if (typeof text !== "string" || typeof scene !== "string") { report.rejected.badType++; continue; }
    if (!text.trim()) { report.rejected.empty++; continue; }
    if (text.length > MAX_LINE_LEN) { report.rejected.tooLong++; continue; }
    if (!SCENE_KEYS.includes(scene as SceneKey)) { report.rejected.badScene++; continue; }
    if (merged.some(l => l.text === text)) { report.duplicate++; continue; }
    merged.push({ id: makeId(), scene: scene as SceneKey, text });
    report.added++;
  }
  return { config: merged, report };
}

/** 导入报告的人话总结（设置页提示用） */
export function describeImportReport(r: ImportReport): string {
  if (r.rejected.badType === -1) return "这个文件不是有效的台词文件（要 JSON，含 lines 数组）";
  const parts: string[] = [`导入 ${r.added} 条`];
  if (r.duplicate) parts.push(`重复跳过 ${r.duplicate} 条`);
  const rej = r.rejected;
  const bad = rej.badType + rej.tooLong + rej.empty + rej.badScene + rej.overLimit;
  if (bad > 0) {
    const why: string[] = [];
    if (rej.badType) why.push(`字段缺失 ${rej.badType} 条`);
    if (rej.tooLong) why.push(`超长 ${rej.tooLong} 条`);
    if (rej.empty) why.push(`空白 ${rej.empty} 条`);
    if (rej.badScene) why.push(`场景不对 ${rej.badScene} 条`);
    if (rej.overLimit) why.push(`超出 100 条上限 ${rej.overLimit} 条`);
    parts.push(`丢弃 ${bad} 条（${why.join("、")}）`);
  }
  return parts.join("；") + "。";
}
