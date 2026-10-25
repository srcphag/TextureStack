import { describe, expect, it } from 'vitest';
import {
  evaluateShaderPixelCPU,
  flattenOverBlackRGBA,
} from '../../src/engine/reference-cpu';
import { AnimationClock, advanceOffsetLinear } from '../../src/engine/clock';
import {
  DEFAULT_SHADER_PARAMS,
  RawTextureInput,
  ShaderParams,
} from '../../src/engine/types';
import { makeSolidTexture } from '../../src/engine/fixtures';

function makeParams(overrides: Partial<ShaderParams> = {}): ShaderParams {
  return { ...DEFAULT_SHADER_PARAMS, ...overrides };
}

describe('Shader Contract (§4) — CPU Reference Implementation', () => {
  it('selects layers in hard and smooth modes with cyclic off and on', () => {
    const stack: RawTextureInput[] = [
      makeSolidTexture(4, 4, 0, 0, 0),
      makeSolidTexture(4, 4, 100, 0, 0),
      makeSolidTexture(4, 4, 200, 0, 0),
    ];
    // Control luminance = 0.25 -> scaled (n=3, cyclic=0) = 0.25 * 2 = 0.5
    const ctrl = makeSolidTexture(4, 4, 64, 64, 64);

    // Hard switch: floor(0.5 + 0.5) = 1 -> layer 1 (R=100)
    const hardPx = evaluateShaderPixelCPU(
      0.5,
      0.5,
      ctrl,
      null,
      stack,
      makeParams({ numImages: 3, smoothBlend: 0, cyclic: 0 })
    );
    expect(hardPx[0]).toBe(100);
    expect(hardPx[3]).toBe(255);

    // Smooth blend: mix(layer 0, layer 1, ~0.502) -> ~50
    const smoothPx = evaluateShaderPixelCPU(
      0.5,
      0.5,
      ctrl,
      null,
      stack,
      makeParams({ numImages: 3, smoothBlend: 1, cyclic: 0 })
    );
    expect(smoothPx[0]).toBeGreaterThanOrEqual(48);
    expect(smoothPx[0]).toBeLessThanOrEqual(52);
  });

  it('wraps smoothly from last layer back to first layer when cyclic is on', () => {
    const stack: RawTextureInput[] = [
      makeSolidTexture(2, 2, 0, 200, 0), // layer 0: G=200
      makeSolidTexture(2, 2, 200, 0, 0), // layer 1: R=200
    ];
    // With n=2, cyclic=1, lum=0.75 -> scaled = 0.75 * 2 = 1.5 -> idxA=1, idxB=0, t=0.5
    const ctrl = makeSolidTexture(2, 2, 191, 191, 191);
    const px = evaluateShaderPixelCPU(
      0.5,
      0.5,
      ctrl,
      null,
      stack,
      makeParams({ numImages: 2, smoothBlend: 1, cyclic: 1 })
    );
    expect(Math.abs(px[0] - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(px[1] - 100)).toBeLessThanOrEqual(2);
  });

  it('respects n=1, n=2, n=32 and numImages lower than loaded', () => {
    const stack32: RawTextureInput[] = Array.from({ length: 32 }, (_, i) =>
      makeSolidTexture(2, 2, i * 8, 0, 0)
    );
    const whiteCtrl = makeSolidTexture(2, 2, 255, 255, 255);

    // n=1 always returns layer 0 even for white control
    const px1 = evaluateShaderPixelCPU(
      0.5,
      0.5,
      whiteCtrl,
      null,
      stack32,
      makeParams({ numImages: 1, smoothBlend: 0 })
    );
    expect(px1[0]).toBe(0);

    // numImages=4 when 32 are loaded: white control picks layer 3 (3 * 8 = 24)
    const px4 = evaluateShaderPixelCPU(
      0.5,
      0.5,
      whiteCtrl,
      null,
      stack32,
      makeParams({ numImages: 4, smoothBlend: 0 })
    );
    expect(px4[0]).toBe(24);

    // numImages=32: white control picks layer 31 (31 * 8 = 248)
    const px32 = evaluateShaderPixelCPU(
      0.5,
      0.5,
      whiteCtrl,
      null,
      stack32,
      makeParams({ numImages: 32, smoothBlend: 0 })
    );
    expect(px32[0]).toBe(248);
  });

  it('applies BT.709 luma weights (0.2126, 0.7152, 0.0722) to control and mask', () => {
    const stack: RawTextureInput[] = [
      makeSolidTexture(2, 2, 0, 0, 0),
      makeSolidTexture(2, 2, 255, 255, 255),
    ];
    const red = makeSolidTexture(2, 2, 255, 0, 0);
    const green = makeSolidTexture(2, 2, 0, 255, 0);
    const blue = makeSolidTexture(2, 2, 0, 0, 255);

    const pR = evaluateShaderPixelCPU(
      0.5,
      0.5,
      red,
      null,
      stack,
      makeParams({ numImages: 2, smoothBlend: 1 })
    );
    const pG = evaluateShaderPixelCPU(
      0.5,
      0.5,
      green,
      null,
      stack,
      makeParams({ numImages: 2, smoothBlend: 1 })
    );
    const pB = evaluateShaderPixelCPU(
      0.5,
      0.5,
      blue,
      null,
      stack,
      makeParams({ numImages: 2, smoothBlend: 1 })
    );

    expect(Math.abs(pR[0] - Math.round(0.2126 * 255))).toBeLessThanOrEqual(1);
    expect(Math.abs(pG[0] - Math.round(0.7152 * 255))).toBeLessThanOrEqual(1);
    expect(Math.abs(pB[0] - Math.round(0.0722 * 255))).toBeLessThanOrEqual(1);
  });

  it('shows un-contrasted, un-offset original control where mask is black', () => {
    const ctrl = makeSolidTexture(2, 2, 80, 120, 160);
    const blackMask = makeSolidTexture(2, 2, 0, 0, 0);
    const stack = [
      makeSolidTexture(2, 2, 255, 0, 0),
      makeSolidTexture(2, 2, 0, 255, 0),
    ];

    const px = evaluateShaderPixelCPU(
      0.5,
      0.5,
      ctrl,
      blackMask,
      stack,
      makeParams({
        numImages: 2,
        contrast: 3.5,
        offset: 0.7,
        maskInfluence: 1.0,
      })
    );
    expect(px).toEqual([80, 120, 160, 255]);
  });

  it('flattens transparent pixels over black with alpha 255 (D13)', () => {
    const rgba = new Uint8Array([200, 100, 50, 128, 255, 255, 255, 0]);
    const flat = flattenOverBlackRGBA(rgba);
    expect(flat[0]).toBe(Math.round((200 * 128) / 255));
    expect(flat[1]).toBe(Math.round((100 * 128) / 255));
    expect(flat[2]).toBe(Math.round((50 * 128) / 255));
    expect(flat[3]).toBe(255);
    expect(flat[4]).toBe(0);
    expect(flat[5]).toBe(0);
    expect(flat[6]).toBe(0);
    expect(flat[7]).toBe(255);
  });
});

describe('Offset Animation Clock (§3 & §8.2)', () => {
  it('keeps offset still at speed 0, advances linearly for >0, and wraps backwards for <0', () => {
    expect(advanceOffsetLinear(0.35, 0, 5.0)).toBeCloseTo(0.35, 6);
    expect(advanceOffsetLinear(0.2, 0.25, 1.0)).toBeCloseTo(0.45, 6);
    // Wrap 1 -> 0
    expect(advanceOffsetLinear(0.8, 0.5, 1.0)).toBeCloseTo(0.3, 6);
    // Negative speed wraps 0 -> 1
    expect(advanceOffsetLinear(0.1, -0.3, 1.0)).toBeCloseTo(0.8, 6);
    // Doubling speed doubles rate
    const d1 = advanceOffsetLinear(0, 0.15, 2.0);
    const d2 = advanceOffsetLinear(0, 0.3, 2.0);
    expect(d2).toBeCloseTo(d1 * 2, 6);
  });

  it('pauses when tab is hidden with no jump on return', () => {
    const clock = new AnimationClock();
    expect(clock.tick(1000)).toBe(0);
    expect(clock.tick(1500)).toBeCloseTo(0.5, 5);

    clock.setHidden(true, 1600);
    expect(clock.tick(5000)).toBe(0);

    clock.setHidden(false, 8000);
    // No jump from the 6.4s spent hidden
    expect(clock.tick(8200)).toBeCloseTo(0.2, 5);
  });
});
