export const MAX_STACK_LAYERS = 32;
export const DEFAULT_WORKING_WIDTH = 1280;
export const DEFAULT_WORKING_HEIGHT = 720;

export type SourceMode = 'none' | 'image' | 'video' | 'webcam';

export interface ShaderParams {
  /** 1..loaded (default: all loaded images, min 1) */
  numImages: number;
  /** 0 = hard switch, 1 = smooth crossfade (default: 1) */
  smoothBlend: number;
  /** 0 = clamp, 1 = cyclic wrap (default: 0) */
  cyclic: number;
  /** 0..4, 1 = unchanged, 0 = flat grey (default: 1) */
  contrast: number;
  /** 0..1 luminance offset (default: 0) */
  offset: number;
  /** -1..1 full sweeps per second (default: 0) */
  animSpeed: number;
  /** 0 = normal, 1 = invert control RGB before contrast/luma (default: 0) */
  invertControl: number;
  /** 0..1 mask influence (default: 0 when no mask, 1 when mask loaded) */
  maskInfluence: number;
  /** 0 = normal, 1 = invert mask (default: 0) */
  invertMask: number;
  /** 0..1 mask min remap threshold (default: 0) */
  maskMin: number;
  /** 0..1 mask max remap threshold (default: 1) */
  maskMax: number;
}

export const DEFAULT_SHADER_PARAMS: Readonly<ShaderParams> = {
  numImages: 1,
  smoothBlend: 1,
  cyclic: 0,
  contrast: 1,
  offset: 0,
  animSpeed: 0,
  invertControl: 0,
  maskInfluence: 0,
  invertMask: 0,
  maskMin: 0,
  maskMax: 1,
};

export interface StackLayerItem {
  id: string;
  name: string;
  width: number;
  height: number;
  thumbnailUrl: string;
  /** Pre-flattened (opaque RGBA8) cover-fitted pixel buffer at working resolution */
  rgbaData?: Uint8Array;
  /** Original drawable source so re-fitting on working resolution change stays crisp */
  sourceElement?: HTMLImageElement | HTMLCanvasElement;
}

export interface MediaSourceState {
  mode: SourceMode;
  name: string;
  width: number;
  height: number;
  thumbnailUrl: string;
  playing: boolean;
  currentTime: number;
  duration: number;
}

export interface AppError {
  id: string;
  message: string;
  timestamp: number;
}

export interface AppState {
  params: ShaderParams;
  workingWidth: number;
  workingHeight: number;
  stack: StackLayerItem[];
  controlSource: MediaSourceState;
  maskSource: MediaSourceState;
  hasMask: boolean;
  errors: AppError[];
  statsVisible: boolean;
  fps: number;
  frameTimeMs: number;
  frameCount: number;
}

export interface RawTextureInput {
  width: number;
  height: number;
  /** RGBA8 row-major top-to-bottom (4 bytes per pixel) */
  data: Uint8Array | Uint8ClampedArray;
}

export interface TextureStackDebugAPI {
  getState(): AppState;
  setParam<K extends keyof ShaderParams>(key: K, value: ShaderParams[K]): void;
  resetParam(key: keyof ShaderParams): void;
  resetGroup(group: 'shader' | 'control' | 'mask' | 'animation' | 'all'): void;
  setWorkingResolution(width: number, height: number): void;
  setControlRaw(tex: RawTextureInput, name?: string): void;
  setMaskRaw(tex: RawTextureInput | null, name?: string): void;
  setStackRaw(layers: RawTextureInput[], names?: string[]): void;
  loadStackImageWithAlpha(width: number, height: number, rgba: Uint8Array, name?: string): void;
  removeStackLayer(index: number): void;
  reorderStackLayer(fromIndex: number, toIndex: number): void;
  clearMask(): void;
  stepClock(dtSeconds: number): void;
  setTabHiddenSimulated(hidden: boolean): void;
  renderNow(): void;
  readPixels(x?: number, y?: number, width?: number, height?: number): Uint8Array;
  readPixelAtUV(u: number, v: number): [number, number, number, number];
  getFrameCount(): number;
  getGlErrors(): number[];
  triggerError(message: string): void;
  clearErrors(): void;
  captureSnapshotDataUrl(): string;
}

declare global {
  interface Window {
    __TEXTURE_STACK_DEBUG__?: TextureStackDebugAPI;
  }
}
