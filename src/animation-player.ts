export interface BoardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AnimationEffects {
  shake_px_of_240?: number;
  pulse?: number;
  sway_deg?: number;
  sigh?: number;
}

export interface AnimationSpec {
  frames: string[];
  order: number[];
  dur_ms: number;
  dur_by_frame_ms?: Record<string, number>;
  lift_px_of_240?: number[];
  squash?: number[];
  canvas: number;
  anchor: "bottom-center" | string;
  effects?: AnimationEffects;
  effects_note?: string;
  boardRect?: BoardRect;
}

export type PlaybackMode = "loop" | "once";

export interface TimelineSample {
  sequenceIndex: number;
  frameNumber: number;
  frameFile: string;
  duration: number;
  done: boolean;
}

export interface AnimatedSample extends TimelineSample {
  kind: "animation";
  id: string;
  spec: AnimationSpec;
}

export interface StaticSample {
  kind: "static";
  id: string;
}

export type PlaybackSample = AnimatedSample | StaticSample;

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function frameDuration(spec: AnimationSpec, frameNumber: number): number {
  return positive(spec.dur_by_frame_ms?.[String(frameNumber)], positive(spec.dur_ms, 100));
}

export function timelineDuration(spec: AnimationSpec): number {
  return spec.order.reduce((total, frameNumber) => total + frameDuration(spec, frameNumber), 0);
}

export function isUsableAnimation(spec: AnimationSpec | null | undefined): spec is AnimationSpec {
  if (!spec || !Array.isArray(spec.frames) || !spec.frames.length || !Array.isArray(spec.order) || !spec.order.length) return false;
  return spec.order.every(frameNumber => Number.isInteger(frameNumber) && frameNumber >= 1 && frameNumber <= spec.frames.length);
}

export function sampleTimeline(spec: AnimationSpec, elapsedMs: number, mode: PlaybackMode): TimelineSample {
  if (!isUsableAnimation(spec)) throw new Error("动画配置没有可播放帧");
  const total = timelineDuration(spec);
  const elapsed = Math.max(0, elapsedMs);
  const done = mode === "once" && elapsed >= total;
  let cursor = done ? Math.max(0, total - 1) : mode === "loop" ? elapsed % total : elapsed;
  let sequenceIndex = spec.order.length - 1;
  for (let index = 0; index < spec.order.length; index += 1) {
    const duration = frameDuration(spec, spec.order[index]);
    if (cursor < duration) {
      sequenceIndex = index;
      break;
    }
    cursor -= duration;
  }
  const frameNumber = spec.order[sequenceIndex];
  return {
    sequenceIndex,
    frameNumber,
    frameFile: spec.frames[frameNumber - 1],
    duration: frameDuration(spec, frameNumber),
    done,
  };
}

interface ActivePlayback {
  id: string;
  spec: AnimationSpec | null;
  mode: PlaybackMode;
  startedAt: number;
}

export class AnimationPlayback {
  private active: ActivePlayback | null = null;

  play(id: string, spec: AnimationSpec | null | undefined, mode: PlaybackMode, now = performance.now()): void {
    this.active = { id, spec: isUsableAnimation(spec) ? spec : null, mode, startedAt: now };
  }

  clear(): void {
    this.active = null;
  }

  sample(now = performance.now()): PlaybackSample | null {
    const active = this.active;
    if (!active) return null;
    if (!active.spec) return { kind: "static", id: active.id };
    return {
      kind: "animation",
      id: active.id,
      spec: active.spec,
      ...sampleTimeline(active.spec, now - active.startedAt, active.mode),
    };
  }
}

export interface FrameTransform {
  lift: number;
  translateX: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
}

export function frameTransform(spec: AnimationSpec, sequenceIndex: number, displaySize: number): FrameTransform {
  const frameNumber = spec.order[sequenceIndex] ?? 1;
  const lift = (spec.lift_px_of_240?.[frameNumber - 1] ?? 0) * displaySize / 240;
  const squash = spec.squash?.[frameNumber - 1] ?? 0;
  const effects = spec.effects ?? {};
  const count = Math.max(1, spec.order.length);
  const phase = 2 * Math.PI * sequenceIndex / count;
  const wave = 0.5 - 0.5 * Math.cos(phase);
  const pulseScale = 1 + (effects.pulse ?? 0) * wave;
  const sigh = effects.sigh ?? 0;
  return {
    lift,
    translateX: (effects.shake_px_of_240 ?? 0) * displaySize / 240 * (sequenceIndex % 2 === 0 ? 1 : -1),
    scaleX: pulseScale * (1 + 0.35 * sigh * wave) * (1 + squash * 0.35),
    scaleY: pulseScale * (1 - sigh * wave) * (1 - squash),
    rotate: (effects.sway_deg ?? 0) * Math.sin(phase),
  };
}
