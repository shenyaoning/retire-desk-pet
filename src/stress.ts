import { stressTexts } from "./stress-texts";
import { createStressState, hitStress, stressExpired, stressFrame, stressScale, type StressState } from "./stress-state";
import { setStressActive as setReminderStressActive, recordStressHit } from "./reminder-center";
import { setStressActive as setTodoStressActive } from "./todo-center";

type ImageMap = Record<string, HTMLImageElement>;
let state: StressState | null = null;
let timer: number | undefined;
let images: ImageMap | null = null;
let onFinish: (() => void) | null = null;
let photoImage: HTMLImageElement | null = null;

const asset = (name: string) => `${import.meta.env.BASE_URL}assets/stress/${encodeURIComponent(name)}`;
function load(name: string): Promise<HTMLImageElement> { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = asset(name); }); }
async function ensureImages(): Promise<ImageMap> {
  if (images) return images;
  const names = ["怪兽-1.png", "怪兽-2.png", "怪兽-3.png", "怪兽-4.png", "怪兽-5.png", "怪兽-无头身体.png", "怪兽-一对角.png", "狼牙棒.png", "拍击闪光.png"];
  const loaded = await Promise.all(names.map(load));
  images = Object.fromEntries(names.map((name, index) => [name, loaded[index]])); return images;
}

function photo(): string | null { return localStorage.getItem("rdp.v1.stress-photo"); }
// 狼牙棒：256 画布里柄底中心是 (125,229)（解压参数.json 里 512 坐标 (250,458) 折半），
// 以它为轴心，在小恶魔头顶右上方挥下：+60°（向右上扬起）→ −100°（砸到头上）→ 回位
const CLUB_PIVOT: [number, number] = [125, 229];
const CLUB_SCALE = 0.5;
const CLUB_ORIGIN: [number, number] = [228, 80];
const SWING_MS = 220, FLASH_END_MS = 380, RETURN_END_MS = 380;
function clubAngle(t: number): number | null {
  if (t < SWING_MS) { const k = t / SWING_MS; return 60 - 160 * k * k; }
  if (t < RETURN_END_MS) return -100 + 160 * ((t - SWING_MS) / (RETURN_END_MS - SWING_MS));
  return null;
}
let hitStart = 0, rafId = 0;
function playHit(): void {
  hitStart = performance.now();
  window.cancelAnimationFrame(rafId);
  const step = (now: number) => {
    if (!state) return;
    const t = now - hitStart;
    const angle = clubAngle(t);
    draw(!!photo(), t >= SWING_MS - 20 && t < FLASH_END_MS, angle);
    if (angle !== null) rafId = window.requestAnimationFrame(step); else draw();
  };
  rafId = window.requestAnimationFrame(step);
}

function draw(photoMode = !!photo(), flash = false, angle: number | null = null): void {
  if (!state || !images) return;
  const canvas = document.getElementById("stress-canvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!; ctx.clearRect(0, 0, 256, 256);
  const scale = stressScale(state.hits); const frame = stressFrame(state.hits);
  ctx.save(); ctx.translate(128, 240); ctx.scale(scale, scale); ctx.translate(-128, -240);
  if (photoMode && frame !== 5) {
    ctx.drawImage(images["怪兽-无头身体.png"], 0, 0, 256, 256);
    if (photoImage?.complete) { ctx.save(); ctx.beginPath(); ctx.arc(128, 95, 75, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(photoImage, 53, 20, 150, 150); ctx.restore(); }
    ctx.drawImage(images["怪兽-一对角.png"], 0, 0, 256, 256);
  } else ctx.drawImage(images[`怪兽-${frame}.png`], 0, 0, 256, 256);
  ctx.restore();
  if (angle !== null) {
    // 怪兽以 (128,240) 为中心缩小，头心 y 从 95 往下沉；棒子的落点跟着降低，缩小后仍然砸在头上
    ctx.save(); ctx.translate(CLUB_ORIGIN[0], CLUB_ORIGIN[1] + (1 - scale) * 145); ctx.rotate(angle * Math.PI / 180);
    ctx.drawImage(images["狼牙棒.png"], -CLUB_PIVOT[0] * CLUB_SCALE, -CLUB_PIVOT[1] * CLUB_SCALE, 256 * CLUB_SCALE, 256 * CLUB_SCALE);
    ctx.restore();
  }
  if (flash) {
    const fy = 88 + (1 - scale) * 145, fs = 145 * (0.55 + 0.45 * scale);   // 闪光和「啪」跟着缩小后的头走
    ctx.drawImage(images["拍击闪光.png"], 128 - fs / 2, fy - fs / 2, fs, fs);
    ctx.fillStyle = "#493025"; ctx.font = `${Math.round(28 * (0.6 + 0.4 * scale))}px "ArkPixel", monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("啪", 128, fy + 4); ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
  }
}

function updateHud() {
  if (!state) return;
  const remaining = Math.max(0, Math.ceil((30_000 - (Date.now() - state.startedAt)) / 1000));
  (document.getElementById("stress-time") as HTMLElement).textContent = `${remaining} 秒`;
  (document.getElementById("stress-hits") as HTMLElement).textContent = `${state.hits} 次`;
}

function stop() {
  if (!state) return;
  state = null; window.clearInterval(timer); timer = undefined;
  document.getElementById("stress-game")?.classList.add("hidden");
  setReminderStressActive(false); setTodoStressActive(false); onFinish?.(); onFinish = null;
}

export async function startStressGame(finish: () => void): Promise<void> {
  const game = document.getElementById("stress-game")!;
  game.classList.remove("hidden"); onFinish = finish; state = createStressState(Date.now());
  (document.getElementById("stress-title") as HTMLElement).textContent = store.settings.stressName || "烦恼魔";
  setReminderStressActive(true); setTodoStressActive(true);
  const savedPhoto = photo(); photoImage = savedPhoto ? new Image() : null;
  if (photoImage) { photoImage.onload = () => draw(true); photoImage.src = savedPhoto!; }
  try { await ensureImages(); draw(); updateHud(); }
  catch { stop(); return; }
  const canvas = document.getElementById("stress-canvas")!;
  canvas.onclick = () => {
    if (!state) return;
    state = hitStress(state); recordStressHit(); playHit();
    (document.getElementById("stress-word") as HTMLElement).textContent = stressTexts[(state.hits - 1) % stressTexts.length];
    updateHud(); if (state.ended) window.setTimeout(stop, 500);
  };
  document.getElementById("stress-end")!.onclick = () => stop();
  timer = window.setInterval(() => {
    if (state && stressExpired(state, Date.now())) { state = { ...state, hits: 25, ended: true }; draw(!!photo()); window.setTimeout(stop, 450); }
    else updateHud();
  }, 250);
}

export function stopStressGame(): void { stop(); }
import { store } from "./store";
