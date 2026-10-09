import { isUsableAnimation, type AnimationSpec } from "./animation-player";

interface AnimationIndexEntry {
  id: string;
  directory: string;
}

interface AnimationIndex {
  animations: AnimationIndexEntry[];
}

interface CachedFrame {
  image: HTMLImageElement;
  usedAt: number;
}

export class AnimationCatalog {
  private readonly entries: Map<string, AnimationIndexEntry>;
  private readonly specs = new Map<string, Promise<AnimationSpec | null>>();
  private readonly frames = new Map<string, CachedFrame>();
  private readonly loadingFrames = new Map<string, Promise<HTMLImageElement>>();
  private useCounter = 0;

  private constructor(entries: AnimationIndexEntry[], private readonly maxDecodedFrames = 24) {
    this.entries = new Map(entries.map(entry => [entry.id, entry]));
  }

  static empty(): AnimationCatalog {
    return new AnimationCatalog([]);
  }

  static async load(maxDecodedFrames = 8): Promise<AnimationCatalog> {
    const response = await fetch(`${AnimationCatalog.baseUrl()}index.json`);
    if (!response.ok) throw new Error("动画目录加载失败");
    const index = await response.json() as AnimationIndex;
    return new AnimationCatalog(Array.isArray(index.animations) ? index.animations : [], maxDecodedFrames);
  }

  private static baseUrl(): string {
    return `${import.meta.env.BASE_URL}assets/animations/`;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  async spec(id: string): Promise<AnimationSpec | null> {
    const existing = this.specs.get(id);
    if (existing) return existing;
    const entry = this.entries.get(id);
    if (!entry) return null;
    const request = fetch(`${this.directoryUrl(entry)}anim.json`)
      .then(async response => {
        if (!response.ok) return null;
        const spec = await response.json() as AnimationSpec;
        return isUsableAnimation(spec) ? spec : null;
      })
      .catch(() => null);
    this.specs.set(id, request);
    return request;
  }

  async preload(id: string, spec: AnimationSpec): Promise<void> {
    // Start quickly with just the first two distinct frames. Remaining frames are
    // decoded on demand and the small LRU keeps inactive animations out of memory.
    await Promise.all([...new Set(spec.frames)].slice(0, 2).map(file => this.frame(id, file)));
  }

  async frame(id: string, file: string): Promise<HTMLImageElement> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`动画不存在：${id}`);
    const key = `${id}/${file}`;
    const cached = this.frames.get(key);
    if (cached) {
      cached.usedAt = ++this.useCounter;
      return cached.image;
    }
    const loading = this.loadingFrames.get(key);
    if (loading) return loading;
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        this.loadingFrames.delete(key);
        this.frames.set(key, { image, usedAt: ++this.useCounter });
        this.evict();
        resolve(image);
      };
      image.onerror = () => {
        this.loadingFrames.delete(key);
        reject(new Error(`动画帧加载失败：${key}`));
      };
      image.src = `${this.directoryUrl(entry)}${encodeURIComponent(file)}`;
    });
    this.loadingFrames.set(key, promise);
    return promise;
  }

  releaseAll(): void {
    for (const cached of this.frames.values()) cached.image.src = "";
    this.frames.clear();
    this.loadingFrames.clear();
  }

  get decodedFrameCount(): number {
    return this.frames.size;
  }

  private directoryUrl(entry: AnimationIndexEntry): string {
    return `${AnimationCatalog.baseUrl()}${encodeURIComponent(entry.directory)}/`;
  }

  private evict(): void {
    while (this.frames.size > this.maxDecodedFrames) {
      let oldestKey = "";
      let oldestUse = Infinity;
      for (const [key, value] of this.frames) {
        if (value.usedAt < oldestUse) {
          oldestKey = key;
          oldestUse = value.usedAt;
        }
      }
      if (!oldestKey) return;
      const old = this.frames.get(oldestKey);
      if (old) old.image.src = "";
      this.frames.delete(oldestKey);
    }
  }
}
