/** 入口：加载皮肤 → 初始化桌宠/设置 → 绑定全局事件。 */
import "./dev-shim";
import { SpriteSet, ensureFont } from "./sprite";
import { store, defaults } from "./store";
import {
  setSprites, setAnimations, setScale, setBaseSize, setupPet, PET_SIZES,
  startLoop, resetBaseAnim, restoreOrPlace, setMode, refreshInfo,
} from "./pet";
import { AnimationCatalog } from "./animation-assets";
import { bindPanel } from "./panel";
import { setDaysBridge } from "./settings-lines";
import { bindShare } from "./share";

async function applyPetLayout(scale: number) {
  setScale(scale);
  const size = PET_SIZES[scale as keyof typeof PET_SIZES] ?? 128;
  setBaseSize(size + 36, size + 58);
  const stage = document.getElementById("stage") as HTMLElement;
  stage.style.width = `${size + 6}px`;
  stage.style.height = `${size + 6}px`;
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new Error(`[step:${name}] ${e instanceof Error ? e.message : String(e)}`);
  }
}

function refreshInfoSafe(): Promise<number | null> {
  return refreshInfo().then(i => (i ? i.days_left : null)).catch(() => null);
}

async function main() {
  await step("font", ensureFont);
  const sprites = await step("skin", () => SpriteSet.load(store.settings.skin));
  // 默认静态表情时完全不请求动画索引或帧，避免把可选资源带入 WebView 内存。
  const animations = store.settings.animations
    ? await AnimationCatalog.load().catch(() => AnimationCatalog.empty())
    : AnimationCatalog.empty();
  setSprites(sprites);
  setAnimations(animations);
  setDaysBridge(() => refreshInfoSafe());
  await step("bind", async () => {
    bindPanel(sprites);
    bindShare(sprites);
  });

  // 首次使用：先弹设置
  if (!store.ready) {
    store.mode = "settings";
  }

  await step("layout", async () => applyPetLayout(store.settings.scale));

  await step("setup", () => setupPet());

  if (store.mode === "settings" || !store.ready) {
    await step("open-settings", async () => {
      await import("./pet").then(m => m.openSettings());
    });
  } else if (store.mode === "panel") {
    await step("open-panel", async () => {
      await import("./pet").then(m => m.openPanel());
    });
  } else if (store.mode === "share") {
    // 浏览器调试用：?mode=share 直接出分享卡
    await step("open-share", async () => {
      const { openShare } = await import("./share");
      document.getElementById("pet-view")!.classList.add("hidden");
      document.getElementById("share-view")!.classList.remove("hidden");
      await openShare(sprites);
    });
  } else {
    await step("restore", restoreOrPlace);
    startLoop();
    resetBaseAnim();
    setMode("pet");
  }
}

// 任何没接住的错误都记到日志，方便排查（/tmp/retire-desk-pet-debug.log）
const logErr = (tag: string, e: unknown) => {
  const d = (e instanceof Error && e.stack) ? e.stack : String(e);
  void import("@tauri-apps/api/core").then(m => m.invoke("debug_log", { msg: `${tag}: ${d}` })).catch(() => {});
};
window.addEventListener("error", (e) => logErr("window.error", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => logErr("unhandledrejection", e.reason));

main().catch(err => {
  console.error(err);
  const detail = (err instanceof Error && err.stack) ? err.stack : String(err);
  document.body.innerHTML =
    `<pre style="color:#c00;background:#fff;padding:6px;white-space:pre-wrap;font-size:18px;line-height:1.3">${detail}</pre>`;
  void import("@tauri-apps/api/core").then(m =>
    m.invoke("debug_log", { msg: `BOOT FAIL: ${detail}` }));
  void defaults;
});
