// Types for the parts of pixelfx Peek uses (index.js): the loading orb. The library itself is plain JavaScript.
export type Frame = { w: number; h: number; ox: number; oy: number; color: Uint32Array; light: Uint32Array };
export type Meta = { name: string; size?: [number, number]; origin?: [number, number]; duration?: number; loop?: boolean; fps?: number; options?: Record<string, unknown> };
export type FxModule = { meta: Meta };
export type FxOptions = { x?: number; y?: number; seed?: number; palette?: string[] } & Record<string, unknown>;
export type Fx = { meta: Meta; readonly t: number; update(dt: number): void; draw(frame: Frame, layer?: "back" | "front"): void; stop(): void };
export function createFrame(w: number, h: number, ox?: number, oy?: number): Frame;
export function clearFrame(f: Frame): Frame;
export function createFx(mod: FxModule, o?: FxOptions): Fx;
export function composite(f: Frame, out: Uint8ClampedArray, bg?: number | Uint32Array | null, lightK?: number): Uint8ClampedArray;
export const xpOrb: FxModule;
