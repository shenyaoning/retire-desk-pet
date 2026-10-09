/** 分享卡：1080×1920，表情图绘制 + 天数 + 一句台词 + 产品名。不含出生日期和具体退休日期。 */
import { invoke } from "@tauri-apps/api/core";
import { toast } from "./ui";
import type { SpriteSet } from "./sprite";
import { getInfo } from "./pet";
import { pickLine, renderLine } from "./lines-service";
import { store } from "./store";
import { todayReminderStats } from "./reminder-center";

export async function openShare(sprites: SpriteSet) {
  setModeShare(true);
  const cv = document.getElementById("share-canvas") as HTMLCanvasElement;
  const ctx = cv.getContext("2d")!;
  const info = getInfo();
  const days = info && info.days_left >= 0 ? info.days_left : 0;

  // 背景
  const grad = ctx.createLinearGradient(0, 0, 0, 1920);
  grad.addColorStop(0, "#2f3a56");
  grad.addColorStop(0.6, "#3d5270");
  grad.addColorStop(1, "#4a6fb3");
  const paintBg = () => {
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1920);
    ctx.fillStyle = "rgba(247, 209, 84, .9)";
    const stars: [number, number, number][] = [
      [120, 220, 5], [300, 140, 3], [880, 200, 4], [960, 420, 3],
      [80, 700, 3], [990, 780, 5], [160, 1560, 4], [920, 1620, 3],
    ];
    for (const [x, y, r] of stars) drawStar(ctx, x, y, r);
  };
  paintBg();

  // 分享卡新版排版留给阶段 C；头像先接入新皮肤。
  const imageSize = 460;
  const px = (1080 - imageSize) / 2;
  const py = 680;
  ctx.fillStyle = "rgba(0,0,0,.18)";
  ctx.beginPath();
  ctx.ellipse(540, py + imageSize - 12, 200, 36, 0, 0, Math.PI * 2);
  ctx.fill();
  const hero = (document.getElementById("share-hero") as HTMLSelectElement | null)?.value || "mood-16";
  ctx.drawImage(sprites.image(hero), px, py, imageSize, imageSize);
  if (hero === "mood-16") {
    ctx.fillStyle = "#493025"; ctx.font = '64px "ArkPixel", monospace';
    ctx.fillText(`${days}天`, 540, py + imageSize * .62);
  }

  // 文案
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff8ec";
  ctx.font = '48px "ArkPixel", monospace';
  ctx.fillText("距离退休还有", 540, 340);
  ctx.font = '200px "ArkPixel", monospace';
  ctx.fillStyle = "#f7d154";
  ctx.fillText(`${days}`, 540, 500);
  ctx.font = '48px "ArkPixel", monospace';
  ctx.fillStyle = "#fff8ec";
  ctx.fillText("天", 540, 610);

  // 台词：分享卡只从「退休相关」组抽（含用户写的该场景台词，权重规则同气泡）
  const pick = pickLine(store.linesCfg, "retire");
  const line = renderLine(pick.text, days);
  ctx.font = '36px "ArkPixel", monospace';
  ctx.fillStyle = "rgba(255, 248, 236, .92)";
  ctx.fillText(line, 540, 1260);
  if (store.settings.shareStandups) {
    ctx.font = '30px "ArkPixel", monospace';
    ctx.fillStyle = "rgba(255, 248, 236, .82)";
    ctx.fillText(`今天起身 ${todayReminderStats().standUps} 次`, 540, 1340);
  }

  ctx.font = '28px "ArkPixel", monospace';
  ctx.fillStyle = "rgba(255, 248, 236, .6)";
  ctx.fillText("退休桌宠 · 和你一起数着日子", 540, 1780);
  void ctx;
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillRect(-r / 6, -r, r / 3, r * 2);
  ctx.fillRect(-r, -r / 6, r * 2, r / 3);
  ctx.restore();
}


function setModeShare(on: boolean) {
  document.getElementById("share-view")!.classList.toggle("hidden", !on);
}

export function bindShare(sprites: SpriteSet) {
  const standups = document.getElementById("share-standups") as HTMLInputElement;
  standups.checked = !!store.settings.shareStandups;
  standups.addEventListener("change", () => {
    const settings = store.settings; settings.shareStandups = standups.checked; store.settings = settings;
  });
  document.getElementById("share-hero")?.addEventListener("change", () => {
    void openShare(sprites);
  });
  document.getElementById("share-back")!.addEventListener("click", () => setModeShare(false));
  document.getElementById("share-save")!.addEventListener("click", async () => {
    const cv = document.getElementById("share-canvas") as HTMLCanvasElement;
    const blob = await new Promise<Blob | null>(r => cv.toBlob(r, "image/png"));
    if (!blob) return;
    const buf = new Uint8Array(await blob.arrayBuffer());
    const r = await invoke("save_png", { data: Array.from(buf) }).catch(e => `${e}`);
    if (r === "已取消") return;
    void r;
  });
  document.getElementById("share-copy")!.addEventListener("click", async () => {
    const cv = document.getElementById("share-canvas") as HTMLCanvasElement;
    const ctx = cv.getContext("2d")!;
    const data = ctx.getImageData(0, 0, cv.width, cv.height);
    const ok = await invoke("copy_rgba", {
      rgba: Array.from(data.data), width: cv.width, height: cv.height,
    }).then(() => true).catch(e => { toast(`复制失败：${e}`, "err"); return false; });
    if (ok) toast("已复制到剪贴板");
  });
}
