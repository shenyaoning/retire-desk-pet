/** 台词抽取与导入逻辑的单元测试 */
import { describe, expect, it } from "vitest";
import { lines, SCENE_KEYS } from "./lines";
import {
  describeImportReport, exportLines, importLines, pickLine, renderLine, validateCustomLine,
  MAX_CUSTOM_LINES, MAX_LINE_LEN, type CustomLine, type LinesConfig,
} from "./lines-service";

/** 可复位的伪随机（0,1,2,3... 取模），让统计测试稳定 */
function seqRng(mod: number) {
  let i = 0;
  return () => ((i++) % mod) / mod;
}

const base: LinesConfig = { custom: [], disabledBuiltin: [], mode: "mix", style: "normal" };   // 这些用例只验证抽取逻辑，固定用「正常」风格

function customLine(text: string, scene: CustomLine["scene"] = "general"): CustomLine {
  return { id: text, scene, text };
}

describe("内置台词定稿", () => {
  it("共 45 条，分组数量与定稿一致", () => {
    expect(SCENE_KEYS).toEqual(["general", "morning", "lunch", "afternoon", "evening", "friday", "retire"]);
    expect(lines.general).toHaveLength(20);
    expect(lines.morning).toHaveLength(4);
    expect(lines.lunch).toHaveLength(4);
    expect(lines.afternoon).toHaveLength(4);
    expect(lines.evening).toHaveLength(4);
    expect(lines.friday).toHaveLength(3);
    expect(lines.retire).toHaveLength(6);
  });

  it("没有空白台词、没有超过 30 字的", () => {
    for (const k of SCENE_KEYS) {
      for (const t of lines[k]) {
        expect(t.trim().length, `${k}: ${t}`).toBeGreaterThan(0);
        expect(t.length, `${k}: ${t}`).toBeLessThanOrEqual(MAX_LINE_LEN);
      }
    }
  });
});

describe("pickLine 抽取", () => {
  it("builtin_only：只出内置，关掉的不出现", () => {
    const cfg: LinesConfig = { ...base, mode: "builtin_only", disabledBuiltin: [lines.general[0]] };
    for (let i = 0; i < 50; i++) {
      const r = pickLine(cfg, "general", { rng: seqRng(7) });
      expect(r.text).not.toBe(lines.general[0]);
      expect(lines.general).toContain(r.text);
    }
  });

  it("custom_only：有自定义就只出自定义", () => {
    const cfg: LinesConfig = {
      ...base, mode: "custom_only",
      custom: [customLine("我的台词A"), customLine("我的台词B")],
    };
    for (let i = 0; i < 30; i++) {
      const r = pickLine(cfg, "general", { rng: seqRng(7) });
      expect(["我的台词A", "我的台词B"]).toContain(r.text);
      expect(r.source).toBe("custom");
    }
  });

  it("custom_only 但一条自定义都没有：回退混合并带提示", () => {
    const cfg: LinesConfig = { ...base, mode: "custom_only" };
    const r = pickLine(cfg, "general", { rng: seqRng(7) });
    expect(lines.general).toContain(r.text);
    expect(r.fallbackReason).toContain("混合");
  });

  it("场景没有可用台词时回退「平时」组", () => {
    // custom_only，friday 场景没有自定义，但 general 有
    const cfg: LinesConfig = {
      ...base, mode: "custom_only",
      custom: [customLine("平时专用", "general")],
    };
    const r = pickLine(cfg, "friday", { rng: seqRng(7) });
    expect(r.text).toBe("平时专用");
  });

  it("mix 模式：我的台词权重是内置的 3 倍（1 内置 vs 1 自定义 → 约 75%）", () => {
    // 只留一条内置，权重对比才干净
    const cfg: LinesConfig = {
      ...base, mode: "mix",
      disabledBuiltin: lines.general.slice(1),
      custom: [customLine("自定义S")],
    };
    let customCount = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const r = pickLine(cfg, "general", { rng: Math.random });
      if (r.text === "自定义S") customCount++;
    }
    const ratio = customCount / N;
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(0.8);
  });

  it("临近退休：平时场景会混入 retire 组", () => {
    // 把 general 全关，只留 retire 可出
    const cfg: LinesConfig = { ...base, mode: "builtin_only", disabledBuiltin: [...lines.general] };
    const r = pickLine(cfg, "general", { rng: seqRng(7), nearRetire: true });
    expect(lines.retire).toContain(r.text);
    // 非临近退休：general 全空且没有自定义 → 兜底
    const r2 = pickLine(cfg, "general", { rng: seqRng(7), nearRetire: false });
    expect(r2.text).toBe("……");
  });

  it("临近退休：general 与 retire 两组各占一半概率（组级 50/50）", () => {
    const cfg: LinesConfig = { ...base, mode: "builtin_only" };
    let retireCount = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const r = pickLine(cfg, "general", { rng: Math.random, nearRetire: true });
      if (lines.retire.includes(r.text)) retireCount++;
    }
    const ratio = retireCount / N;
    expect(ratio).toBeGreaterThan(0.44);
    expect(ratio).toBeLessThan(0.56);
  });

  it("全空兜底不出错", () => {
    const cfg: LinesConfig = { ...base, mode: "custom_only" };
    const r = pickLine(cfg, "general");
    expect(typeof r.text).toBe("string");
  });
});

describe("renderLine", () => {
  it("替换 {days}", () => {
    expect(renderLine("还剩 {days} 天", 42)).toBe("还剩 42 天");
    expect(renderLine("{days}天，{days}天", 1)).toBe("1天，1天");
  });
  it("没有天数时用 ? 占位", () => {
    expect(renderLine("还剩 {days} 天", null)).toBe("还剩 ? 天");
  });
});

describe("validateCustomLine", () => {
  it("空白与纯空格拒绝", () => {
    expect(validateCustomLine("", "general", [])).toContain("空白");
    expect(validateCustomLine("   ", "general", [])).toContain("空白");
  });
  it("超过 30 字拒绝并提示超出字数", () => {
    const long = "一".repeat(31);
    expect(validateCustomLine(long, "general", [])).toContain("超出 1 个字");
    expect(validateCustomLine("一".repeat(30), "general", [])).toBeNull();
  });
  it("重复拒绝", () => {
    const existing = [customLine("已有一条")];
    expect(validateCustomLine("已有一条", "general", existing)).toContain("已经在列表里");
  });
});

describe("importLines / exportLines", () => {
  it("非 JSON 文件被拒绝（badType=-1），不抛异常", () => {
    const r = importLines("这不是JSON{{{", []);
    expect(r.report.rejected.badType).toBe(-1);
    expect(r.config).toHaveLength(0);
  });

  it("JSON 对象但没有 lines 数组也被拒绝", () => {
    const r = importLines(JSON.stringify({ foo: 1 }), []);
    expect(r.report.rejected.badType).toBe(-1);
  });

  it("合法导入：入库、生成 id", () => {
    const raw = JSON.stringify({ lines: [{ scene: "general", text: "导入的一条" }] });
    const r = importLines(raw, []);
    expect(r.report.added).toBe(1);
    expect(r.config[0].text).toBe("导入的一条");
    expect(r.config[0].id).toBeTruthy();
  });

  it("兼容纯数组格式", () => {
    const r = importLines(JSON.stringify([{ scene: "friday", text: "周五快乐" }]), []);
    expect(r.report.added).toBe(1);
    expect(r.config[0].scene).toBe("friday");
  });

  it("超长/空白/字段缺失/场景不对 分别计数丢弃", () => {
    const raw = JSON.stringify({ lines: [
      { scene: "general", text: "一".repeat(31) },   // 超长
      { scene: "general", text: "   " },             // 空白
      { scene: "general" },                          // 缺 text
      { scene: "半夜", text: "场景不对" },            // 场景不合法
      42,                                            // 类型不对
      { scene: "general", text: "正常的一条" },
    ] });
    const r = importLines(raw, []);
    expect(r.report.added).toBe(1);
    expect(r.report.rejected.tooLong).toBe(1);
    expect(r.report.rejected.empty).toBe(1);
    expect(r.report.rejected.badType).toBe(2);
    expect(r.report.rejected.badScene).toBe(1);
    expect(r.config[0].text).toBe("正常的一条");
  });

  it("与现有台词去重、批内也去重", () => {
    const existing = [customLine("已有")];
    const raw = JSON.stringify({ lines: [
      { scene: "general", text: "已有" },
      { scene: "general", text: "已有" },
      { scene: "general", text: "新的" },
      { scene: "general", text: "新的" },
    ] });
    const r = importLines(raw, existing);
    expect(r.report.added).toBe(1);
    expect(r.report.duplicate).toBe(3);
    expect(r.config).toHaveLength(2);
  });

  it("超过 100 条上限的部分丢弃并计数", () => {
    const existing: CustomLine[] = Array.from({ length: MAX_CUSTOM_LINES }, (_, i) =>
      customLine(`已有${i}`));
    const raw = JSON.stringify({ lines: [
      { scene: "general", text: "塞不下的一" },
      { scene: "general", text: "塞不下的二" },
    ] });
    const r = importLines(raw, existing);
    expect(r.config).toHaveLength(MAX_CUSTOM_LINES);
    expect(r.report.rejected.overLimit).toBe(2);
  });

  it("导出→导入往返不丢数据", () => {
    const cfg: LinesConfig = {
      custom: [customLine("甲", "morning"), customLine("乙", "retire")],
      disabledBuiltin: [], mode: "mix",
    };
    const json = exportLines(cfg);
    const r = importLines(json, []);
    expect(r.report.added).toBe(2);
    expect(r.config.map(l => `${l.scene}:${l.text}`).sort())
      .toEqual(["morning:甲", "retire:乙"]);
  });

  it("导入报告有人话总结", () => {
    const r = importLines("not json", []);
    expect(describeImportReport(r.report)).toContain("不是有效的台词文件");
  });
});
