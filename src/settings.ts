/** 设置页：退休信息、桌宠行为、皮肤列表、清除数据。 */
import { store, defaults, type Profile } from "./store";
import { invoke } from "@tauri-apps/api/core";
import { closeToPet, resetBaseAnim, setScale, setBaseSize, PET_SIZES, checkSignEvents, afterProfileSaved } from "./pet";
import { renderLinesSection } from "./settings-lines";
import { toast, confirmDialog } from "./ui";
import { resetReminderSchedule, updateReminderEnvironment } from "./reminder-center";
import { validateStressPhoto } from "./stress-state";


const $sel = (id: string) => document.getElementById(id) as HTMLSelectElement;
const pad2 = (n: number) => String(n).padStart(2, "0");

function fillOptions(sel: HTMLSelectElement, placeholder: string, values: number[], keep?: string) {
  sel.innerHTML = "";
  const first = document.createElement("option");
  first.value = ""; first.textContent = placeholder;
  sel.appendChild(first);
  for (const v of values) {
    const o = document.createElement("option");
    o.value = String(v); o.textContent = String(v);
    sel.appendChild(o);
  }
  if (keep && values.map(String).includes(keep)) sel.value = keep;
}

function daysIn(y: number | null, m: number | null): number {
  if (!m) return 31;
  return new Date(y ?? 2000, m, 0).getDate();
}

/** 出生年月日、参加工作年月全部用上下选择，不让用户手填格式 */
function setupYmd(p: Profile) {
  const thisYear = new Date().getFullYear();
  const range = (a: number, b: number) => {
    const out: number[] = [];
    if (a <= b) for (let i = a; i <= b; i++) out.push(i); else for (let i = a; i >= b; i--) out.push(i);
    return out;
  };
  const [by, bm] = p.birthYm ? p.birthYm.split("-").map(Number) : [0, 0];
  fillOptions($sel("s-by"), "选年", range(thisYear - 16, 1945), by ? String(by) : undefined);
  fillOptions($sel("s-bm"), "选月", range(1, 12), bm ? String(bm) : undefined);
  const refillDay = (keep?: string) => {
    const y = Number($sel("s-by").value) || null, m = Number($sel("s-bm").value) || null;
    fillOptions($sel("s-bd"), "不选", range(1, daysIn(y, m)), keep ?? $sel("s-bd").value);
  };
  refillDay(p.birthDay ? String(p.birthDay) : undefined);
  const [jy, jm] = p.joinYm ? p.joinYm.split("-").map(Number) : [0, 0];
  fillOptions($sel("s-jy"), "不填", range(thisYear, 1960), jy ? String(jy) : undefined);
  fillOptions($sel("s-jm"), "不填", range(1, 12), jm ? String(jm) : undefined);

  for (const id of ["s-by", "s-bm"]) $sel(id).onchange = () => { refillDay(); void updatePreview(); };
  for (const id of ["s-bd", "s-category"]) $sel(id).onchange = () => void updatePreview();
  $sel("s-jy").onchange = () => { if (!$sel("s-jm").value && $sel("s-jy").value) $sel("s-jm").value = "1"; };
  document.getElementById("s-error")!.textContent = "";
  void updatePreview();
}

function readProfile(): { profile: Profile | null; error: string } {
  const by = $sel("s-by").value, bm = $sel("s-bm").value;
  if (!by || !bm) return { profile: null, error: "请先选好出生的年和月" };
  const day = Number($sel("s-bd").value) || undefined;
  const jy = $sel("s-jy").value, jm = $sel("s-jm").value;
  if (jy && !jm) return { profile: null, error: "参加工作选了年，还要选月（不想填就把年改回「不填」）" };
  return {
    profile: {
      birthYm: `${by}-${pad2(Number(bm))}`,
      birthDay: day,
      category: $sel("s-category").value as Profile["category"],
      joinYm: jy ? `${jy}-${pad2(Number(jm))}` : undefined,
    },
    error: "",
  };
}

/** 选完立刻在设置页里算出退休日期，看得见才放心 */
async function updatePreview() {
  const box = document.getElementById("s-preview")!;
  const { profile } = readProfile();
  box.classList.remove("err");
  if (!profile) {
    box.textContent = "选好出生日期和类别，这里会显示你的退休日期。";
    return;
  }
  try {
    const r = await invoke<{ retire_date: string; days_left: number; retire_age_label: string; retire_ym: string }>(
      "get_retire_info",
      { birthYm: profile.birthYm, birthDay: profile.birthDay ?? null, category: profile.category, joinYm: null, flexMonths: 0 });
    const [y, m, d] = r.retire_date.split("-").map(Number);
    const note = profile.birthDay ? "" : "（没选出生日，按当月 1 日算）";
    box.innerHTML = r.days_left >= 0
      ? `法定退休年龄：<b>${r.retire_age_label}</b><br>退休时间：<b>${y}年${m}月${d}日</b>${note}<br>距今还有 <b>${r.days_left}</b> 天`
      : `法定退休年龄：<b>${r.retire_age_label}</b><br>退休时间：<b>${y}年${m}月${d}日</b>，已经到啦`;
  } catch (e) {
    box.classList.add("err");
    box.textContent = `没算出来：${e}`;
  }
}

let selectedSkin = "default";

async function renderSkinList() {
  const list = document.querySelector(".skin-list")!;
  const res = await fetch(`${import.meta.env.BASE_URL}assets/skins/index.json`);
  const ids = res.ok ? await res.json() as string[] : ["default"];
  list.replaceChildren();
  for (const id of ids) {
    const manifest = await fetch(`${import.meta.env.BASE_URL}assets/skins/${encodeURIComponent(id)}/manifest.json`).then(r => r.json()) as { name: string };
    const button = document.createElement("button");
    button.type = "button";
    button.className = `skin-item${id === selectedSkin ? " on" : ""}`;
    button.textContent = manifest.name;
    button.addEventListener("click", () => {
      selectedSkin = id;
      list.querySelectorAll("button").forEach(b => b.classList.remove("on"));
      button.classList.add("on");
    });
    list.appendChild(button);
  }
}

export function renderSettings() {
  const p = store.profile;
  const s = store.settings;
  selectedSkin = s.skin;
  void renderSkinList();

  (document.getElementById("s-category") as HTMLSelectElement).value = p.category;
  setupYmd(p);
  (document.getElementById("s-scale") as HTMLSelectElement).value = String(s.scale);
  (document.getElementById("s-offwork") as HTMLInputElement).value = s.offWork;
  (document.getElementById("s-payday") as HTMLInputElement).value = String(s.payday);
  (document.getElementById("s-bubble") as HTMLInputElement).checked = s.showBubble;
  (document.getElementById("s-badge") as HTMLInputElement).checked = s.showBadge;
  (document.getElementById("s-todobadge") as HTMLInputElement).checked = s.showTodoBadge !== false;
  (document.getElementById("s-avoidfs") as HTMLInputElement).checked = s.avoidFullscreen;
  (document.getElementById("s-remind-sedentary") as HTMLInputElement).checked = s.reminders.sedentaryEnabled;
  (document.getElementById("s-remind-water") as HTMLInputElement).checked = s.reminders.waterEnabled;
  (document.getElementById("s-remind-eye") as HTMLInputElement).checked = s.reminders.eyeEnabled;
  (document.getElementById("s-remind-exercise") as HTMLInputElement).checked = s.reminders.exerciseEnabled;
  (document.getElementById("s-remind-sound") as HTMLInputElement).checked = s.reminders.sound;
  (document.getElementById("s-lunch-alarm") as HTMLInputElement).checked = s.reminders.lunchAlarm;
  (document.getElementById("s-meeting") as HTMLInputElement).checked = s.meetingMode;
  (document.getElementById("s-animations") as HTMLInputElement).checked = s.animations === true;
  (document.getElementById("s-stress-enabled") as HTMLInputElement).checked = s.stressEnabled === true;
  (document.getElementById("s-stress-name") as HTMLInputElement).value = s.stressName || "烦恼魔";
  (document.getElementById("s-sedentary-minutes") as HTMLSelectElement).value = String(s.reminders.sedentaryMinutes);
  (document.getElementById("s-water-goal") as HTMLInputElement).value = String(s.reminders.waterGoal);
  (document.getElementById("s-water-minutes") as HTMLInputElement).value = String(s.reminders.waterMinutes);
  (document.getElementById("s-eye-minutes") as HTMLSelectElement).value = String(s.reminders.eyeMinutes);
  (document.getElementById("s-exercise-goal") as HTMLInputElement).value = String(s.reminders.exerciseGoal);
  (document.getElementById("s-exercise-morning") as HTMLInputElement).value = s.reminders.exerciseMorning;
  (document.getElementById("s-exercise-afternoon") as HTMLInputElement).value = s.reminders.exerciseAfternoon;
  (document.getElementById("s-focus-minutes") as HTMLSelectElement).value = String(s.reminders.focusMinutes);
  (document.getElementById("s-lunch-minutes") as HTMLSelectElement).value = String(s.reminders.lunchMinutes);
  (document.getElementById("s-lunch-wake-time") as HTMLInputElement).value = s.reminders.lunchWakeTime;
  (document.getElementById("s-hourly-limit") as HTMLInputElement).value = String(s.reminders.hourlyLimit);
  (document.getElementById("s-active-from") as HTMLInputElement).value = s.reminders.activeFrom;
  (document.getElementById("s-active-to") as HTMLInputElement).value = s.reminders.activeTo;
  (document.getElementById("s-lunch-from") as HTMLInputElement).value = s.reminders.lunchFrom;
  (document.getElementById("s-lunch-to") as HTMLInputElement).value = s.reminders.lunchTo;

  (document.getElementById("s-bosskey") as HTMLInputElement).value = "(默认 Ctrl/Cmd+Alt+H)";

  void invoke<boolean>("get_autostart").then(v => {
    (document.getElementById("s-autostart") as HTMLInputElement).checked = v;
  });
  void invoke<boolean>("avoid_get_enabled").then(v => {
    (document.getElementById("s-avoidfs") as HTMLInputElement).checked = v;
  });

  bindOnce();
  renderLinesSection();
}

let bound = false;

function bindOnce() {
  if (bound) return;
  bound = true;
  const photoInput = document.getElementById("s-stress-photo") as HTMLInputElement;
  photoInput.addEventListener("change", () => { void saveStressPhoto(photoInput.files?.[0] ?? null); });
  document.getElementById("s-stress-reset")?.addEventListener("click", () => {
    localStorage.removeItem("rdp.v1.stress-photo"); photoInput.value = ""; toast("已恢复默认小恶魔头");
  });

  document.getElementById("s-bosskey-set")?.addEventListener("click", async () => {
    document.body.classList.add("listening");
    const accel = await nextKeyCombo();
    document.body.classList.remove("listening");
    if (accel) {
      const r = await invoke("set_boss_key", { accel }).catch(e => `${e}`);
      if (r === undefined || r === null) {
        store.settings.bossKey = accel;
        (document.getElementById("s-bosskey") as HTMLInputElement).value = accel;
      } else {
        toast(`快捷键设置失败：${r}`, "err");
      }
    }
  });

  document.getElementById("s-save")?.addEventListener("click", async () => {
    try { await doSave(); } catch (e) {
      const msg = `保存没完成：${e instanceof Error ? e.message : String(e)}`;
      document.getElementById("s-error")!.textContent = msg;
      toast(msg, "err");
      void invoke("debug_log", { msg: `save: ${e instanceof Error ? e.stack : String(e)}` });
    }
  });

  async function doSave() {
    const { profile, error } = readProfile();
    const errEl = document.getElementById("s-error")!;
    if (!profile) {
      errEl.textContent = error;
      toast(error, "err");
      document.getElementById("s-by")!.scrollIntoView({ block: "center" });
      return;
    }
    errEl.textContent = "";
    store.profile = profile;
    const s = store.settings;
    s.scale = Number((document.getElementById("s-scale") as HTMLSelectElement).value) as typeof s.scale;
    s.offWork = (document.getElementById("s-offwork") as HTMLInputElement).value || "17:30";
    s.payday = Number((document.getElementById("s-payday") as HTMLInputElement).value) || 15;
    s.showBubble = (document.getElementById("s-bubble") as HTMLInputElement).checked;
    s.showBadge = (document.getElementById("s-badge") as HTMLInputElement).checked;
    s.showTodoBadge = (document.getElementById("s-todobadge") as HTMLInputElement).checked;
    s.avoidFullscreen = (document.getElementById("s-avoidfs") as HTMLInputElement).checked;
    s.meetingMode = (document.getElementById("s-meeting") as HTMLInputElement).checked;
    const animationsChanged = s.animations !== (document.getElementById("s-animations") as HTMLInputElement).checked;
    s.animations = (document.getElementById("s-animations") as HTMLInputElement).checked;
    s.stressEnabled = (document.getElementById("s-stress-enabled") as HTMLInputElement).checked;
    s.stressName = (document.getElementById("s-stress-name") as HTMLInputElement).value.trim().slice(0, 8) || "烦恼魔";
    s.reminders.sedentaryEnabled = (document.getElementById("s-remind-sedentary") as HTMLInputElement).checked;
    s.reminders.waterEnabled = (document.getElementById("s-remind-water") as HTMLInputElement).checked;
    s.reminders.eyeEnabled = (document.getElementById("s-remind-eye") as HTMLInputElement).checked;
    s.reminders.exerciseEnabled = (document.getElementById("s-remind-exercise") as HTMLInputElement).checked;
    s.reminders.sound = (document.getElementById("s-remind-sound") as HTMLInputElement).checked;
    s.reminders.lunchAlarm = (document.getElementById("s-lunch-alarm") as HTMLInputElement).checked;
    s.reminders.sedentaryMinutes = Number((document.getElementById("s-sedentary-minutes") as HTMLSelectElement).value) as 45 | 60 | 90;
    s.reminders.waterGoal = Math.min(20, Math.max(1, Number((document.getElementById("s-water-goal") as HTMLInputElement).value) || 8));
    s.reminders.waterMinutes = Math.min(240, Math.max(15, Number((document.getElementById("s-water-minutes") as HTMLInputElement).value) || 90));
    s.reminders.eyeMinutes = Number((document.getElementById("s-eye-minutes") as HTMLSelectElement).value) as 20 | 30 | 45;
    s.reminders.exerciseGoal = Math.min(8, Math.max(1, Number((document.getElementById("s-exercise-goal") as HTMLInputElement).value) || 3));
    s.reminders.exerciseMorning = (document.getElementById("s-exercise-morning") as HTMLInputElement).value || "10:30";
    s.reminders.exerciseAfternoon = (document.getElementById("s-exercise-afternoon") as HTMLInputElement).value || "15:30";
    s.reminders.focusMinutes = Number((document.getElementById("s-focus-minutes") as HTMLSelectElement).value) as 15 | 25 | 45;
    s.reminders.lunchMinutes = Number((document.getElementById("s-lunch-minutes") as HTMLSelectElement).value) as 20 | 30 | 45 | 60;
    s.reminders.lunchWakeTime = (document.getElementById("s-lunch-wake-time") as HTMLInputElement).value || "13:30";
    s.reminders.hourlyLimit = Math.min(12, Math.max(1, Number((document.getElementById("s-hourly-limit") as HTMLInputElement).value) || 3));
    s.reminders.activeFrom = (document.getElementById("s-active-from") as HTMLInputElement).value || "09:00";
    s.reminders.activeTo = (document.getElementById("s-active-to") as HTMLInputElement).value || "17:30";
    s.reminders.lunchFrom = (document.getElementById("s-lunch-from") as HTMLInputElement).value || "12:00";
    s.reminders.lunchTo = (document.getElementById("s-lunch-to") as HTMLInputElement).value || "14:00";
    const skinChanged = s.skin !== selectedSkin;
    s.skin = selectedSkin;
    store.settings = s;
    resetReminderSchedule();
    updateReminderEnvironment({});
    await invoke("avoid_set_enabled", { enabled: s.avoidFullscreen });
    await invoke("set_autostart", { enable: (document.getElementById("s-autostart") as HTMLInputElement).checked }).catch(() => {});

    setScale(s.scale);
    setBaseSize(PET_SIZES[s.scale] + 36, PET_SIZES[s.scale] + 58);
    resetBaseAnim();
    await closeToPet();
    await afterProfileSaved();
    if (skinChanged || animationsChanged) { window.location.reload(); return; }
    void checkSignEvents();
  }

  document.getElementById("s-back")?.addEventListener("click", () => void closeToPet());

  document.getElementById("s-clear")?.addEventListener("click", async () => {
    if (!(await confirmDialog("确定清除所有数据吗？设置和里程碑记录都会清空，且无法恢复。", "继续", "取消"))) return;
    if (!(await confirmDialog("再确认一次：真的清除所有数据？", "清除", "取消"))) return;
    store.clearAll();
    store.profile = { ...defaults.profile };
    store.settings = { ...defaults.settings };
    window.location.reload();
  });
}

async function saveStressPhoto(file: File | null): Promise<void> {
  if (!file) return;
  const error = validateStressPhoto(file);
  if (error) { toast(error, "err"); return; }
  const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
  const size = Math.min(image.width, image.height); const sx = Math.floor((image.width - size) / 2), sy = Math.floor((image.height - size) / 2);
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!; ctx.beginPath(); ctx.arc(128, 128, 128, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(image, sx, sy, size, size, 0, 0, 256, 256);
  localStorage.setItem("rdp.v1.stress-photo", canvas.toDataURL("image/png")); toast("照片已保存在本机");
}

/** 捕获下一个按键组合（老板键改键）；Esc 取消 */
function nextKeyCombo(): Promise<string | null> {
  return new Promise((resolve) => {
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener("keydown", handler, true);
      if (e.key === "Escape") { resolve(null); return; }
      const parts: string[] = [];
      if (e.metaKey) parts.push("Cmd");
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      const k = e.key;
      if (["Control", "Meta", "Alt", "Shift"].includes(k)) { resolve(null); return; }
      const name = k.length === 1 ? k.toUpperCase() : k;
      parts.push(name);
      resolve(parts.join("+"));
    };
    window.addEventListener("keydown", handler, true);
  });
}
