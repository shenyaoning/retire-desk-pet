import type { SpriteSet } from "./sprite";
import { AnimationCatalog } from "./animation-assets";
import {
  AnimationPlayback,
  frameTransform,
  type AnimationSpec,
  type PlaybackMode,
} from "./animation-player";

export interface PlayOptions {
  mode: PlaybackMode;
  restart?: boolean;
  useAnimation?: boolean;
  fallbackMs?: number;
  onDone?: () => void;
}

interface AnimatorOptions {
  size: () => number;
  active: () => boolean;
  reserveLift: (pixels: number) => void;
  enabled?: () => boolean;
}

export class PetAnimator {
  private readonly playback = new AnimationPlayback();
  private timer: number | undefined;
  private generation = 0;
  private activeCanvas = 0;
  private currentId = "";
  private currentKey = "";
  private lastSequenceIndex = -1;

  constructor(
    private readonly sprites: SpriteSet,
    private readonly animations: AnimationCatalog,
    private readonly options: AnimatorOptions,
  ) {}

  async play(id: string, options: PlayOptions): Promise<void> {
    const key = `${id}:${options.mode}`;
    if (!options.restart && this.currentKey === key) return;
    this.currentKey = key;
    const generation = ++this.generation;
    window.clearTimeout(this.timer);
    this.playback.clear();
    this.lastSequenceIndex = -1;

    const spec = options.useAnimation === false || this.options.enabled?.() === false ? null : await this.animations.spec(id);
    if (generation !== this.generation || !this.options.active()) return;
    if (!spec) {
      this.options.reserveLift(0);
      this.drawStatic(id);
      if (options.mode === "once") {
        this.timer = window.setTimeout(() => this.finish(generation, options.onDone), options.fallbackMs ?? 1200);
      }
      return;
    }

    try {
      await this.animations.preload(id, spec);
    } catch {
      if (generation !== this.generation || !this.options.active()) return;
      this.options.reserveLift(0);
      this.drawStatic(id);
      if (options.mode === "once") {
        this.timer = window.setTimeout(() => this.finish(generation, options.onDone), options.fallbackMs ?? 1200);
      }
      return;
    }
    if (generation !== this.generation || !this.options.active()) return;

    const maxLift = Math.max(0, ...(spec.lift_px_of_240 ?? [])) * this.options.size() / 240;
    this.options.reserveLift(maxLift);
    this.playback.play(id, spec, options.mode);
    await this.drawAnimationFrame(generation, true);
    this.scheduleNext(generation, options);
  }

  pause(): void {
    this.generation += 1;
    this.currentKey = "";
    this.playback.clear();
    window.clearTimeout(this.timer);
    this.options.reserveLift(0);
  }

  invalidateSize(): void {
    this.currentKey = "";
  }

  async getSpec(id: string): Promise<AnimationSpec | null> {
    return this.animations.spec(id);
  }

  private async drawAnimationFrame(generation: number, first: boolean): Promise<void> {
    const sample = this.playback.sample();
    if (!sample || sample.kind !== "animation" || sample.done || sample.sequenceIndex === this.lastSequenceIndex) return;
    const image = await this.animations.frame(sample.id, sample.frameFile);
    if (generation !== this.generation || !this.options.active()) return;
    const canvas = this.canvas(first && sample.id !== this.currentId ? 1 - this.activeCanvas : this.activeCanvas);
    this.prepareCanvas(canvas);
    const size = this.options.size();
    const context = canvas.getContext("2d")!;
    context.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    context.clearRect(0, 0, size, size);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, size, size);
    this.applyTransform(canvas, sample.spec, sample.sequenceIndex);
    if (first && sample.id !== this.currentId) this.crossfadeTo(canvas);
    this.currentId = sample.id;
    this.lastSequenceIndex = sample.sequenceIndex;
    this.debugTitle(sample.id, sample.sequenceIndex, sample.frameNumber);
  }

  private scheduleNext(generation: number, options: PlayOptions): void {
    if (generation !== this.generation || !this.options.active()) return;
    const sample = this.playback.sample();
    if (!sample || sample.kind !== "animation") return;
    if (sample.done) {
      this.finish(generation, options.onDone);
      return;
    }
    this.timer = window.setTimeout(async () => {
      if (generation !== this.generation || !this.options.active()) return;
      const next = this.playback.sample();
      if (next?.kind === "animation" && next.done) {
        this.finish(generation, options.onDone);
        return;
      }
      await this.drawAnimationFrame(generation, false);
      this.scheduleNext(generation, options);
    }, sample.duration);
  }

  private finish(generation: number, onDone?: () => void): void {
    if (generation !== this.generation) return;
    window.clearTimeout(this.timer);
    this.currentKey = "";
    this.playback.clear();
    this.options.reserveLift(0);
    onDone?.();
  }

  private drawStatic(id: string): void {
    const switchCanvas = id !== this.currentId;
    const canvas = this.canvas(switchCanvas ? 1 - this.activeCanvas : this.activeCanvas);
    this.prepareCanvas(canvas);
    const size = this.options.size();
    const context = canvas.getContext("2d")!;
    context.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    this.sprites.draw(context, id, size);
    canvas.style.transform = "none";
    if (switchCanvas) this.crossfadeTo(canvas);
    this.currentId = id;
    this.debugTitle(id, -1, -1);
  }

  private prepareCanvas(canvas: HTMLCanvasElement): void {
    const size = this.options.size();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(size * dpr);
    if (canvas.width !== width || canvas.height !== width) {
      canvas.width = width;
      canvas.height = width;
    }
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
  }

  private applyTransform(canvas: HTMLCanvasElement, spec: AnimationSpec, sequenceIndex: number): void {
    const frame = frameTransform(spec, sequenceIndex, this.options.size());
    canvas.style.transformOrigin = "50% 100%";
    canvas.style.transform = `translate(${frame.translateX}px, ${-frame.lift}px) rotate(${frame.rotate}deg) scale(${frame.scaleX}, ${frame.scaleY})`;
  }

  private crossfadeTo(canvas: HTMLCanvasElement): void {
    const next = canvas.id === "pet" ? 0 : 1;
    canvas.classList.add("visible");
    this.canvas(this.activeCanvas).classList.remove("visible");
    this.activeCanvas = next;
  }

  private canvas(index: number): HTMLCanvasElement {
    return document.getElementById(index === 0 ? "pet" : "pet-next") as HTMLCanvasElement;
  }

  private debugTitle(id: string, sequenceIndex: number, frameNumber: number): void {
    if ((window as unknown as { __DEV_SHIM__?: boolean }).__DEV_SHIM__) {
      document.title = sequenceIndex >= 0 ? `${id}:s${sequenceIndex}:f${frameNumber}` : id;
    }
  }
}
