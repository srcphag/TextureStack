import { RawTextureInput, ShaderParams } from './types';

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function fract(v: number): number {
  return v - Math.floor(v);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Sample an RGBA8 texture using nearest-neighbor at normalized UV in [0, 1].
 * Returns [r, g, b, a] normalized in [0, 1].
 */
export function sampleNearestRGBA(
  tex: RawTextureInput,
  u: number,
  v: number
): [number, number, number, number] {
  const uc = clamp(u, 0, 1);
  const vc = clamp(v, 0, 1);
  const x = clamp(Math.floor(uc * tex.width), 0, tex.width - 1);
  const y = clamp(Math.floor(vc * tex.height), 0, tex.height - 1);
  const idx = (y * tex.width + x) * 4;
  return [
    tex.data[idx] / 255,
    tex.data[idx + 1] / 255,
    tex.data[idx + 2] / 255,
    tex.data[idx + 3] / 255,
  ];
}

/**
 * Flatten an RGBA8 buffer over solid black (#000000) so alpha is always 255 (Spec D13).
 */
export function flattenOverBlackRGBA(
  rgba: Uint8Array | Uint8ClampedArray
): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    out[i] = Math.round(rgba[i] * a);
    out[i + 1] = Math.round(rgba[i + 1] * a);
    out[i + 2] = Math.round(rgba[i + 2] * a);
    out[i + 3] = 255;
  }
  return out;
}

/**
 * Plain-code CPU reference implementation of the §4 Shader Contract.
 * Evaluates a single pixel at normalized (u, v) in [0, 1] and returns [R, G, B, A] in 0..255.
 */
export function evaluateShaderPixelCPU(
  u: number,
  v: number,
  controlTex: RawTextureInput,
  maskTex: RawTextureInput | null,
  stackLayers: RawTextureInput[],
  params: ShaderParams
): [number, number, number, number] {
  const loadedCount = Math.max(stackLayers.length, 1);
  const n = Math.max(Math.min(Math.floor(params.numImages), loadedCount), 1);
  const nf = n;

  const [cR, cG, cB] = sampleNearestRGBA(controlTex, u, v);

  // Optional invertControl (defaults to 0, where ctrlRgb == controlColor.rgb)
  const invCtrl = params.invertControl >= 0.5 ? 1 : 0;
  const ctrlR = invCtrl ? 1.0 - cR : cR;
  const ctrlG = invCtrl ? 1.0 - cG : cG;
  const ctrlB = invCtrl ? 1.0 - cB : cB;

  // Step 2: Contrast around mid-grey (0.5), clamped to [0, 1], then luminance
  const contR = clamp((ctrlR - 0.5) * params.contrast + 0.5, 0.0, 1.0);
  const contG = clamp((ctrlG - 0.5) * params.contrast + 0.5, 0.0, 1.0);
  const contB = clamp((ctrlB - 0.5) * params.contrast + 0.5, 0.0, 1.0);
  const lum = contR * LUMA_R + contG * LUMA_G + contB * LUMA_B;

  const fetchLayer = (idx: number): [number, number, number] => {
    if (stackLayers.length === 0) return [0, 0, 0];
    const safeIdx = clamp(idx, 0, stackLayers.length - 1);
    const [r, g, b] = sampleNearestRGBA(stackLayers[safeIdx], u, v);
    return [r, g, b];
  };

  // Step 3: Stacked result
  let stackedR = 0;
  let stackedG = 0;
  let stackedB = 0;

  if (params.cyclic > 0.5) {
    const scaled = fract(lum + params.offset) * nf;
    if (params.smoothBlend < 0.5) {
      const idx = ((Math.floor(scaled) % n) + n) % n;
      [stackedR, stackedG, stackedB] = fetchLayer(idx);
    } else {
      const idxA = ((Math.floor(scaled) % n) + n) % n;
      const idxB = (idxA + 1) % n;
      const t = fract(scaled);
      const [rA, gA, bA] = fetchLayer(idxA);
      const [rB, gB, bB] = fetchLayer(idxB);
      stackedR = mix(rA, rB, t);
      stackedG = mix(gA, gB, t);
      stackedB = mix(bA, bB, t);
    }
  } else {
    const scaled = clamp(lum + params.offset, 0.0, 1.0) * (nf - 1.0);
    if (params.smoothBlend < 0.5) {
      const idx = clamp(Math.floor(scaled + 0.5), 0, n - 1);
      [stackedR, stackedG, stackedB] = fetchLayer(idx);
    } else {
      const idxA = clamp(Math.floor(scaled), 0, n - 1);
      const idxB = clamp(idxA + 1, 0, n - 1);
      const t = fract(scaled);
      const [rA, gA, bA] = fetchLayer(idxA);
      const [rB, gB, bB] = fetchLayer(idxB);
      stackedR = mix(rA, rB, t);
      stackedG = mix(gA, gB, t);
      stackedB = mix(bA, bB, t);
    }
  }

  // Step 4: Mask
  let mRaw = 1.0;
  if (maskTex) {
    const [mR, mG, mB] = sampleNearestRGBA(maskTex, u, v);
    mRaw = mR * LUMA_R + mG * LUMA_G + mB * LUMA_B;
  }

  const lo = Math.min(params.maskMin, params.maskMax);
  const hi = Math.max(params.maskMin, params.maskMax);
  let mask = clamp((mRaw - lo) / Math.max(hi - lo, 1e-5), 0.0, 1.0);

  if (params.invertMask >= 0.5) {
    mask = 1.0 - mask;
  }

  const influence = maskTex ? clamp(params.maskInfluence, 0.0, 1.0) : 0.0;
  const m = mix(1.0, mask, influence);

  // Step 5 & 6: Original control image (without contrast or offset) mixed with stacked
  const outR = mix(cR, stackedR, m);
  const outG = mix(cG, stackedG, m);
  const outB = mix(cB, stackedB, m);

  return [
    clamp(Math.round(outR * 255), 0, 255),
    clamp(Math.round(outG * 255), 0, 255),
    clamp(Math.round(outB * 255), 0, 255),
    255,
  ];
}

/**
 * Render an entire image buffer on the CPU using the §4 reference algorithm.
 */
export function renderShaderBufferCPU(
  width: number,
  height: number,
  controlTex: RawTextureInput,
  maskTex: RawTextureInput | null,
  stackLayers: RawTextureInput[],
  params: ShaderParams
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const [r, g, b, a] = evaluateShaderPixelCPU(
        u,
        v,
        controlTex,
        maskTex,
        stackLayers,
        params
      );
      const idx = (y * width + x) * 4;
      out[idx] = r;
      out[idx + 1] = g;
      out[idx + 2] = b;
      out[idx + 3] = a;
    }
  }
  return out;
}
