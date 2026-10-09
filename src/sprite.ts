/** A skin is a folder of full-size transparent sticker images. */
export interface Sticker {
  id: string;
  file: string;
  category: "mood" | "health";
  scenes: string[];
  displayMs: number;
  boardRect?: { x: number; y: number; w: number; h: number };
}
export interface Manifest { id: string; name: string; images: Sticker[] }

export class SpriteSet {
  private cache = new Map<string, HTMLImageElement>();
  private byId: Map<string, Sticker>;
  private constructor(public skin: string, public manifest: Manifest) {
    this.byId = new Map(manifest.images.map(image => [image.id, image]));
  }

  static async load(skin: string): Promise<SpriteSet> {
    const base = `${import.meta.env.BASE_URL}assets/skins/${skin}/`;
    const res = await fetch(base + "manifest.json");
    if (!res.ok) throw new Error(`皮肤加载失败：${skin}`);
    const manifest = await res.json() as Manifest;
    if (!manifest.images?.length) throw new Error(`皮肤没有图片：${skin}`);
    const set = new SpriteSet(skin, manifest);
    await Promise.all(manifest.images.map(image => new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { set.cache.set(image.id, img); resolve(); };
      img.onerror = () => reject(new Error(`图片加载失败：${image.file}`));
      img.src = base + image.file.split("/").map(encodeURIComponent).join("/");
    })));
    return set;
  }

  sticker(id: string): Sticker {
    const sticker = this.byId.get(id);
    if (!sticker) throw new Error(`皮肤缺少表情：${id}`);
    return sticker;
  }

  image(id: string): HTMLImageElement {
    const image = this.cache.get(id);
    if (!image) throw new Error(`图片尚未加载：${id}`);
    return image;
  }

  draw(ctx: CanvasRenderingContext2D, id: string, size: number) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.image(id), 0, 0, size, size);
  }
}

export async function ensureFont() {
  try { await document.fonts.load('12px "ArkPixel"', "离退休还有天秒分时"); } catch { /* system fallback */ }
}
