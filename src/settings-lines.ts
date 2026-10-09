/** 设置页「台词」区：添加/列表/内置开关/模式/导入导出/试说。渲染一律 textContent。 */
import { lines, SCENE_KEYS, SCENE_LABELS, type SceneKey } from "./lines";
import { confirmDialog } from "./ui";
import {
  validateCustomLine, importLines, exportLines, describeImportReport,
  renderLine, MAX_LINE_LEN, makeId, type CustomLine, type LinesMode, type LinesStyle,
} from "./lines-service";
import { store } from "./store";
import type { LinesConfig } from "./lines-service";

let editingId: string | null = null;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function cfg() { return store.linesCfg; }
function saveCfg(c: LinesConfig) { store.linesCfg = c; }

/** 给试说用的天数查询桥（settings.ts 注入 pet.refreshInfo） */
let daysBridge: () => Promise<number | null> = async () => null;
export function setDaysBridge(b: () => Promise<number | null>) { daysBridge = b; }

export function renderLinesSection() {
  const c = cfg();

  const modeSel = el<HTMLSelectElement>("ln-mode");
  modeSel.value = c.mode;
  el<HTMLSelectElement>("ln-style").value = c.style ?? "mix";
  renderModeHint(c.mode, c.custom.length);

  const sceneSel = el<HTMLSelectElement>("ln-scene");
  if (sceneSel.options.length === 0) {
    for (const k of SCENE_KEYS) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = SCENE_LABELS[k];
      sceneSel.appendChild(opt);
    }
  }

  renderCustomList(c.custom);
  renderBuiltinList(c.disabledBuiltin);
  updateCount(el<HTMLInputElement>("ln-input").value);
  el<HTMLParagraphElement>("ln-import-report").textContent = "";
  bindOnce();
}

function renderModeHint(mode: LinesMode, customCount: number) {
  const hint = el<HTMLSpanElement>("ln-mode-hint");
  if (mode === "custom_only" && customCount === 0) {
    hint.textContent = "「我的台词」是空的，会自动按混合模式抽";
  } else if (mode === "mix") {
    hint.textContent = "我的台词出现概率是内置的 3 倍";
  } else {
    hint.textContent = "";
  }
}

function updateCount(text: string) {
  el<HTMLSpanElement>("ln-count").textContent = `${text.length}/${MAX_LINE_LEN}`;
}

function renderCustomList(custom: CustomLine[]) {
  const list = el<HTMLDivElement>("ln-custom-list");
  list.textContent = "";
  if (custom.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "还没有自己的台词。写一句，小人就会说了。";
    list.appendChild(empty);
    return;
  }
  for (const line of custom) {
    const row = document.createElement("div");
    row.className = "ln-row";
    row.dataset.id = line.id;

    if (editingId === line.id) {
      const input = document.createElement("input");
      input.type = "text";
      input.value = line.text;
      input.maxLength = MAX_LINE_LEN;
      input.className = "ln-text";
      const save = document.createElement("button");
      save.textContent = "保存";
      const cancel = document.createElement("button");
      cancel.textContent = "取消";
      save.addEventListener("click", () => {
        const others = cfg().custom.filter(l => l.id !== line.id);
        const err = validateCustomLine(input.value, line.scene, others);
        if (err) { showLineError(err); return; }
        const c = cfg();
        c.custom = c.custom.map(l => l.id === line.id ? { ...l, text: input.value } : l);
        saveCfg(c);
        editingId = null;
        hideLineError();
        renderCustomList(cfg().custom);
      });
      cancel.addEventListener("click", () => { editingId = null; renderCustomList(cfg().custom); });
      row.append(input, save, cancel);
    } else {
      const text = document.createElement("span");
      text.className = "ln-text";
      text.textContent = line.text;
      const tag = document.createElement("span");
      tag.className = "ln-scene-tag";
      tag.textContent = SCENE_LABELS[line.scene];
      const say = document.createElement("button");
      say.textContent = "试说";
      const edit = document.createElement("button");
      edit.textContent = "编辑";
      const del = document.createElement("button");
      del.textContent = "删";
      say.addEventListener("click", () => {
        void daysBridge().then(days => {
          void import("./pet").then(m => m.previewLine(renderLine(line.text, days)));
        });
      });
      edit.addEventListener("click", () => { editingId = line.id; renderCustomList(cfg().custom); });
      del.addEventListener("click", async () => {
        if (!(await confirmDialog(`删除这条台词？\n「${line.text}」`, "删除", "取消"))) return;
        const c = cfg();
        c.custom = c.custom.filter(l => l.id !== line.id);
        saveCfg(c);
        renderCustomList(cfg().custom);
      });
      row.append(text, tag, say, edit, del);
    }
    list.appendChild(row);
  }
}

function builtinSummary(disabled: string[]) {
  let all = 0, off = 0;
  for (const scene of SCENE_KEYS) {
    for (const text of lines[scene]) {
      all++;
      if (disabled.includes(text)) off++;
    }
  }
  el<HTMLElement>("ln-builtin-summary").textContent = `内置台词（共 ${all} 条，关掉 ${off} 条）`;
}

function renderBuiltinList(disabled: string[]) {
  const box = el<HTMLDivElement>("ln-builtin-list");
  box.textContent = "";
  builtinSummary(disabled);
  for (const scene of SCENE_KEYS) {
    const group = document.createElement("div");
    group.className = "ln-builtin-group";
    const h = document.createElement("h4");
    h.textContent = SCENE_LABELS[scene];
    group.appendChild(h);
    for (const text of lines[scene]) {
      const row = document.createElement("div");
      row.className = "ln-builtin-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !disabled.includes(text);
      const label = document.createElement("span");
      label.className = "ln-text";
      label.textContent = text;
      const applyState = () => row.classList.toggle("off", !cb.checked);
      applyState();
      cb.addEventListener("change", () => {
        const c = cfg();
        c.disabledBuiltin = cb.checked
          ? c.disabledBuiltin.filter(t => t !== text)
          : [...c.disabledBuiltin, text];
        saveCfg(c);
        applyState();
        builtinSummary(c.disabledBuiltin);
      });
      row.append(cb, label);
      group.appendChild(row);
    }
    box.appendChild(group);
  }
}

function showLineError(msg: string) {
  const e = el<HTMLParagraphElement>("ln-error");
  e.textContent = msg;
  e.classList.remove("hidden");
}
function hideLineError() {
  el<HTMLParagraphElement>("ln-error").classList.add("hidden");
}

let bound = false;
function bindOnce() {
  if (bound) return;
  bound = true;

  el<HTMLInputElement>("ln-input").addEventListener("input", (e) => {
    updateCount((e.target as HTMLInputElement).value);
    hideLineError();
  });

  el<HTMLButtonElement>("ln-add-btn").addEventListener("click", () => {
    const input = el<HTMLInputElement>("ln-input");
    const scene = el<HTMLSelectElement>("ln-scene").value as SceneKey;
    const c = cfg();
    const err = validateCustomLine(input.value, scene, c.custom);
    if (err) { showLineError(err); return; }
    if (c.custom.length >= 100) { showLineError("最多 100 条，先删掉一些吧"); return; }
    c.custom = [...c.custom, { id: makeId(), scene, text: input.value }];
    saveCfg(c);
    input.value = "";
    updateCount("");
    hideLineError();
    renderCustomList(c.custom);
    renderModeHint(c.mode, c.custom.length);
  });

  el<HTMLSelectElement>("ln-mode").addEventListener("change", (e) => {
    const c = cfg();
    c.mode = (e.target as HTMLSelectElement).value as LinesMode;
    saveCfg(c);
    renderModeHint(c.mode, c.custom.length);
  });

  el<HTMLSelectElement>("ln-style").addEventListener("change", (e) => {
    const c = cfg();
    c.style = (e.target as HTMLSelectElement).value as LinesStyle;
    saveCfg(c);
  });

  el<HTMLButtonElement>("ln-export").addEventListener("click", () => {
    const json = exportLines(cfg());
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    const d = new Date();
    a.download = `我的台词-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(a.href);
    el<HTMLParagraphElement>("ln-import-report").textContent = "已导出为 JSON 文件。";
  });

  el<HTMLButtonElement>("ln-import").addEventListener("click", () => {
    el<HTMLInputElement>("ln-import-file").click();
  });
  el<HTMLInputElement>("ln-import-file").addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = "";
    if (!file) return;
    const raw = await file.text();
    const { config, report } = importLines(raw, cfg().custom);
    saveCfg({ ...cfg(), custom: config });
    renderCustomList(config);
    renderModeHint(cfg().mode, config.length);
    el<HTMLParagraphElement>("ln-import-report").textContent =
      describeImportReport(report) + (config.length >= 100 ? "（已达 100 条上限）" : "");
  });
}
