import { expect, test } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateShaderPixelCPU } from '../../src/engine/reference-cpu';
import {
  DEFAULT_SHADER_PARAMS,
  RawTextureInput,
  ShaderParams,
} from '../../src/engine/types';

function makeSolid(
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  a: number = 255
): RawTextureInput {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { width: w, height: h, data };
}

function makeQuadrantTexture(
  w: number,
  h: number,
  tl: [number, number, number],
  tr: [number, number, number],
  bl: [number, number, number],
  br: [number, number, number]
): RawTextureInput {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const top = y < h / 2;
    for (let x = 0; x < w; x++) {
      const left = x < w / 2;
      const [r, g, b] = top ? (left ? tl : tr) : left ? bl : br;
      const idx = (y * w + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

function expectPixelNear(
  actual: [number, number, number, number],
  expected: [number, number, number, number],
  tolerance: number = 3,
  context: string = ''
): void {
  for (let c = 0; c < 4; c++) {
    const diff = Math.abs(actual[c] - expected[c]);
    expect(
      diff,
      `${context} channel ${c}: actual=${JSON.stringify(actual)} vs expected=${JSON.stringify(expected)}`
    ).toBeLessThanOrEqual(tolerance);
  }
}

test.describe('Texture Stack v0.7 — Automated Verification (§8.2)', () => {
  test('1. Shader GPU pixels match §4 CPU reference across stack, control, mask, orientation, and transparency', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForSelector('[data-testid="render-canvas"]');

    // Use a compact 32x32 working resolution for fast, exact pixel matrix verification
    await page.evaluate(() => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      api.setWorkingResolution(32, 32);
      api.resetGroup('all');
    });

    const W = 32;
    const H = 32;

    const runShaderCase = async (
      name: string,
      control: RawTextureInput,
      mask: RawTextureInput | null,
      stack: RawTextureInput[],
      paramOverrides: Partial<ShaderParams>,
      sampleUVs: [number, number][] = [[0.5, 0.5]]
    ) => {
      const fullParams: ShaderParams = {
        ...DEFAULT_SHADER_PARAMS,
        numImages: stack.length,
        maskInfluence: mask ? 1 : 0,
        ...paramOverrides,
      };

      const gpuResult = await page.evaluate(
        ({ control, mask, stack, fullParams, sampleUVs }) => {
          const api = window.__TEXTURE_STACK_DEBUG__!;
          const toUint8 = (t: { width: number; height: number; data: number[] }) => ({
            width: t.width,
            height: t.height,
            data: new Uint8Array(t.data),
          });
          api.setStackRaw(stack.map(toUint8));
          api.setControlRaw(toUint8(control));
          api.setMaskRaw(mask ? toUint8(mask) : null);

          (Object.keys(fullParams) as (keyof ShaderParams)[]).forEach((k) => {
            api.setParam(k, fullParams[k]);
          });
          api.renderNow();

          const samples = sampleUVs.map(([u, v]) => api.readPixelAtUV(u, v));
          const glErrors = api.getGlErrors();
          return { samples, glErrors };
        },
        {
          control: {
            width: control.width,
            height: control.height,
            data: Array.from(control.data),
          },
          mask: mask
            ? {
                width: mask.width,
                height: mask.height,
                data: Array.from(mask.data),
              }
            : null,
          stack: stack.map((s) => ({
            width: s.width,
            height: s.height,
            data: Array.from(s.data),
          })),
          fullParams,
          sampleUVs,
        }
      );

      expect(gpuResult.glErrors, `${name}: GL errors`).toEqual([]);

      sampleUVs.forEach(([u, v], idx) => {
        const expected = evaluateShaderPixelCPU(
          u,
          v,
          control,
          mask,
          stack,
          fullParams
        );
        expectPixelNear(
          gpuResult.samples[idx],
          expected,
          3,
          `${name} @ uv(${u},${v})`
        );
      });
    };

    const stack4 = [
      makeSolid(W, H, 20, 40, 200),
      makeSolid(W, H, 40, 200, 60),
      makeSolid(W, H, 220, 180, 30),
      makeSolid(W, H, 230, 50, 80),
    ];

    // Stack selection: hard & smooth, cyclic off & on
    for (const lumByte of [0, 55, 110, 175, 230, 255]) {
      const ctrl = makeSolid(W, H, lumByte, lumByte, lumByte);
      await runShaderCase(
        `hard-cyclic-off-lum-${lumByte}`,
        ctrl,
        null,
        stack4,
        { smoothBlend: 0, cyclic: 0 }
      );
      await runShaderCase(
        `smooth-cyclic-off-lum-${lumByte}`,
        ctrl,
        null,
        stack4,
        { smoothBlend: 1, cyclic: 0 }
      );
      await runShaderCase(
        `hard-cyclic-on-lum-${lumByte}`,
        ctrl,
        null,
        stack4,
        { smoothBlend: 0, cyclic: 1 }
      );
      await runShaderCase(
        `smooth-cyclic-on-lum-${lumByte}`,
        ctrl,
        null,
        stack4,
        { smoothBlend: 1, cyclic: 1 }
      );
    }

    // Wrap from last to first layer in cyclic smooth mode (lum = 0.875 with n=4 -> between layer 3 and layer 0)
    await runShaderCase(
      'cyclic-smooth-wrap-last-to-first',
      makeSolid(W, H, 223, 223, 223),
      null,
      stack4,
      { smoothBlend: 1, cyclic: 1 }
    );

    // n = 1, n = 2, n = 32, and numImages lower than loaded
    const stack32 = Array.from({ length: 32 }, (_, i) =>
      makeSolid(W, H, i * 8, 255 - i * 8, (i * 23) % 256)
    );
    await runShaderCase(
      'n=1-single-layer',
      makeSolid(W, H, 200, 200, 200),
      null,
      [stack32[0]],
      { numImages: 1, smoothBlend: 1 }
    );
    await runShaderCase(
      'n=2-layers',
      makeSolid(W, H, 128, 128, 128),
      null,
      stack32.slice(0, 2),
      { numImages: 2, smoothBlend: 1 }
    );
    await runShaderCase(
      'n=32-layers',
      makeSolid(W, H, 190, 190, 190),
      null,
      stack32,
      { numImages: 32, smoothBlend: 0 }
    );
    await runShaderCase(
      'numImages-lower-than-loaded (5 of 32)',
      makeSolid(W, H, 255, 255, 255),
      null,
      stack32,
      { numImages: 5, smoothBlend: 0 }
    );

    // Control: contrast 1 (unchanged), 0 (flat grey), >1 (2.5); offset clamp & wrap; luma weights (pure R, G, B)
    await runShaderCase(
      'contrast-0-flat-grey',
      makeSolid(W, H, 240, 240, 240),
      null,
      stack4,
      { contrast: 0, smoothBlend: 1, cyclic: 0 }
    );
    await runShaderCase(
      'contrast-2.5-boosted',
      makeSolid(W, H, 165, 165, 165),
      null,
      stack4,
      { contrast: 2.5, smoothBlend: 1, cyclic: 0 }
    );
    await runShaderCase(
      'offset-clamped',
      makeSolid(W, H, 180, 180, 180),
      null,
      stack4,
      { offset: 0.6, cyclic: 0, smoothBlend: 0 }
    );
    await runShaderCase(
      'offset-wrapped',
      makeSolid(W, H, 180, 180, 180),
      null,
      stack4,
      { offset: 0.6, cyclic: 1, smoothBlend: 1 }
    );
    await runShaderCase(
      'control-luma-pure-red',
      makeSolid(W, H, 255, 0, 0),
      null,
      stack4,
      { smoothBlend: 1 }
    );
    await runShaderCase(
      'control-luma-pure-green',
      makeSolid(W, H, 0, 255, 0),
      null,
      stack4,
      { smoothBlend: 1 }
    );
    await runShaderCase(
      'control-luma-pure-blue',
      makeSolid(W, H, 0, 0, 255),
      null,
      stack4,
      { smoothBlend: 1 }
    );

    // Mask tests: white, black, mid-grey; min/max remap including min > max; invert; influence 0, 0.5, 1;
    // mask luma weights (R, G, B); original control shown through mask has NO contrast and NO offset
    const distinctCtrl = makeSolid(W, H, 50, 110, 190);
    await runShaderCase(
      'mask-white-shows-stack',
      distinctCtrl,
      makeSolid(W, H, 255, 255, 255),
      stack4,
      { maskInfluence: 1, contrast: 2.5, offset: 0.4 }
    );
    await runShaderCase(
      'mask-black-shows-uncontrasted-unoffset-original',
      distinctCtrl,
      makeSolid(W, H, 0, 0, 0),
      stack4,
      { maskInfluence: 1, contrast: 3.5, offset: 0.8 }
    );
    await runShaderCase(
      'mask-midgrey-mixes-50pct',
      distinctCtrl,
      makeSolid(W, H, 128, 128, 128),
      stack4,
      { maskInfluence: 1 }
    );
    await runShaderCase(
      'mask-min-max-remap-and-min-greater-than-max',
      distinctCtrl,
      makeSolid(W, H, 140, 140, 140),
      stack4,
      { maskInfluence: 1, maskMin: 0.8, maskMax: 0.2 }
    );
    await runShaderCase(
      'mask-invert',
      distinctCtrl,
      makeSolid(W, H, 255, 255, 255),
      stack4,
      { maskInfluence: 1, invertMask: 1 }
    );
    for (const inf of [0, 0.5, 1]) {
      await runShaderCase(
        `mask-influence-${inf}`,
        distinctCtrl,
        makeSolid(W, H, 0, 0, 0),
        stack4,
        { maskInfluence: inf }
      );
    }
    await runShaderCase(
      'mask-luma-pure-red',
      distinctCtrl,
      makeSolid(W, H, 255, 0, 0),
      stack4,
      { maskInfluence: 1 }
    );
    await runShaderCase(
      'mask-luma-pure-green',
      distinctCtrl,
      makeSolid(W, H, 0, 255, 0),
      stack4,
      { maskInfluence: 1 }
    );
    await runShaderCase(
      'mask-luma-pure-blue',
      distinctCtrl,
      makeSolid(W, H, 0, 0, 255),
      stack4,
      { maskInfluence: 1 }
    );

    // Orientation check across all 4 quadrants
    const quadStack = [
      makeQuadrantTexture(
        W,
        H,
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 0]
      ),
    ];
    await runShaderCase(
      'orientation-quadrants',
      makeSolid(W, H, 128, 128, 128),
      null,
      quadStack,
      { numImages: 1 },
      [
        [0.25, 0.25], // Top-Left -> Red
        [0.75, 0.25], // Top-Right -> Green
        [0.25, 0.75], // Bottom-Left -> Blue
        [0.75, 0.75], // Bottom-Right -> Yellow
      ]
    );

    // Video vs Image orientation parity check: create an offscreen video/canvas frame and verify top-left is red
    const videoOrientationPx = await page.evaluate(async () => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      // Create a 2-layer stack: layer 0 = black, layer 1 = bright cyan
      const w = 32;
      const h = 32;
      const l0 = new Uint8Array(w * h * 4);
      const l1 = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h * 4; i += 4) {
        l0[i + 3] = 255;
        l1[i] = 0;
        l1[i + 1] = 200;
        l1[i + 2] = 255;
        l1[i + 3] = 255;
      }
      api.setStackRaw([
        { width: w, height: h, data: l0 },
        { width: w, height: h, data: l1 },
      ]);
      // Control texture with top half white (selects layer 1) and bottom half black (selects layer 0)
      const ctrl = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        const val = y < h / 2 ? 255 : 0;
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          ctrl[idx] = val;
          ctrl[idx + 1] = val;
          ctrl[idx + 2] = val;
          ctrl[idx + 3] = 255;
        }
      }
      api.setControlRaw({ width: w, height: h, data: ctrl });
      api.setMaskRaw(null);
      api.setParam('smoothBlend', 0);
      api.renderNow();
      return {
        top: api.readPixelAtUV(0.5, 0.25),
        bottom: api.readPixelAtUV(0.5, 0.75),
        errs: api.getGlErrors(),
      };
    });
    expect(videoOrientationPx.errs).toEqual([]);
    expectPixelNear(videoOrientationPx.top, [0, 200, 255, 255], 2, 'top half');
    expectPixelNear(videoOrientationPx.bottom, [0, 0, 0, 255], 2, 'bottom half');

    // Transparency check (D13): semi-transparent stack image flattens over black with alpha = 255
    const alphaResult = await page.evaluate(() => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      const rgba = new Uint8Array(32 * 32 * 4);
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = 200;
        rgba[i + 1] = 100;
        rgba[i + 2] = 50;
        rgba[i + 3] = 128; // ~50% alpha
      }
      api.loadStackImageWithAlpha(32, 32, rgba, 'semi_transparent.png');
      api.renderNow();
      return api.readPixelAtUV(0.5, 0.5);
    });
    expectPixelNear(alphaResult, [100, 50, 25, 255], 3, 'alpha flattened over black');
    expect(consoleErrors).toEqual([]);
  });

  test('2. App controls, stack add/remove/reorder, mask disable rule (D11), working resolution, snapshot PNG, and visible errors (D9)', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="render-canvas"]');

    // Mask controls should be disabled initially when no mask is loaded (D11)
    const maskSlider = page.getByTestId('param-maskInfluence-slider');
    await expect(maskSlider).toBeDisabled();

    // Load a mask and verify mask controls become enabled and influence defaults to 1 (D11)
    await page.evaluate(() => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      const w = 16,
        h = 16;
      const data = new Uint8Array(w * h * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
      api.setMaskRaw({ width: w, height: h, data }, 'test_mask.png');
    });
    await expect(maskSlider).toBeEnabled();
    const maskInfAfterLoad = await page.evaluate(
      () => window.__TEXTURE_STACK_DEBUG__!.getState().params.maskInfluence
    );
    expect(maskInfAfterLoad).toBe(1);

    // Clear mask via UI button and verify mask controls disable again and influence becomes 0
    await page.getByTestId('mask-clear-btn').click();
    await expect(maskSlider).toBeDisabled();
    const maskInfAfterClear = await page.evaluate(
      () => window.__TEXTURE_STACK_DEBUG__!.getState().params.maskInfluence
    );
    expect(maskInfAfterClear).toBe(0);

    // Stack reorder and remove test
    const beforeReorderPx = await page.evaluate(() => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      api.setWorkingResolution(16, 16);
      const l0 = new Uint8Array(16 * 16 * 4);
      const l1 = new Uint8Array(16 * 16 * 4);
      for (let i = 0; i < l0.length; i += 4) {
        l0[i] = 220;
        l0[i + 3] = 255; // Layer 0 = Red
        l1[i + 1] = 220;
        l1[i + 3] = 255; // Layer 1 = Green
      }
      api.setStackRaw(
        [
          { width: 16, height: 16, data: l0 },
          { width: 16, height: 16, data: l1 },
        ],
        ['red.png', 'green.png']
      );
      // Black control selects layer 0
      const blk = new Uint8Array(16 * 16 * 4);
      for (let i = 3; i < blk.length; i += 4) blk[i] = 255;
      api.setControlRaw({ width: 16, height: 16, data: blk });
      api.setParam('smoothBlend', 0);
      return api.readPixelAtUV(0.5, 0.5);
    });
    expectPixelNear(beforeReorderPx, [220, 0, 0, 255], 2, 'before reorder');

    // Click move-down on layer 0 in UI
    await page.getByTestId('stack-move-down-0').click();
    const afterReorderPx = await page.evaluate(() =>
      window.__TEXTURE_STACK_DEBUG__!.readPixelAtUV(0.5, 0.5)
    );
    expectPixelNear(afterReorderPx, [0, 220, 0, 255], 2, 'after reorder');

    // Working resolution change via UI inputs
    const wInput = page.getByTestId('resolution-width-input');
    const hInput = page.getByTestId('resolution-height-input');
    await wInput.fill('640');
    await wInput.dispatchEvent('change');
    await hInput.fill('360');
    await hInput.dispatchEvent('change');

    await expect(page.getByTestId('resolution-label')).toHaveText('640 X 360 PX');

    // Verify 32 layers at 1280x720 allocate with zero GL errors (§5 constraint)
    const alloc32 = await page.evaluate(() => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      api.setWorkingResolution(1280, 720);
      const layers = Array.from({ length: 32 }, (_, i) => ({
        width: 8,
        height: 8,
        data: new Uint8Array(8 * 8 * 4).map((_, idx) =>
          idx % 4 === 3 ? 255 : (i * 7) % 256
        ),
      }));
      api.setStackRaw(layers);
      api.renderNow();
      return {
        glErrors: api.getGlErrors(),
        stackLen: api.getState().stack.length,
        width: api.getState().workingWidth,
        height: api.getState().workingHeight,
      };
    });
    expect(alloc32.glErrors).toEqual([]);
    expect(alloc32.stackLen).toBe(32);
    expect(alloc32.width).toBe(1280);
    expect(alloc32.height).toBe(720);

    // Switch back to 640x360 for snapshot test
    await wInput.fill('640');
    await wInput.dispatchEvent('change');
    await hInput.fill('360');
    await hInput.dispatchEvent('change');

    // Verify every control changes the output and reset restores it (D8)
    await page.evaluate(() => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      const l0 = new Uint8Array(16 * 16 * 4);
      const l1 = new Uint8Array(16 * 16 * 4);
      for (let i = 0; i < l0.length; i += 4) {
        l0[i] = 20;
        l0[i + 1] = 40;
        l0[i + 2] = 200;
        l0[i + 3] = 255;
        l1[i] = 220;
        l1[i + 1] = 180;
        l1[i + 2] = 40;
        l1[i + 3] = 255;
      }
      api.setStackRaw([
        { width: 16, height: 16, data: l0 },
        { width: 16, height: 16, data: l1 },
      ]);
      const ctrl = new Uint8Array(16 * 16 * 4);
      for (let i = 0; i < ctrl.length; i += 4) {
        ctrl[i] = 90;
        ctrl[i + 1] = 90;
        ctrl[i + 2] = 90;
        ctrl[i + 3] = 255;
      }
      api.setControlRaw({ width: 16, height: 16, data: ctrl });
      api.resetGroup('all');
    });

    const basePx = await page.evaluate(() =>
      window.__TEXTURE_STACK_DEBUG__!.readPixelAtUV(0.5, 0.5)
    );

    // Contrast change & reset
    await page.getByTestId('param-contrast-slider').fill('3.2');
    await page.getByTestId('param-contrast-slider').dispatchEvent('input');
    const contrastPx = await page.evaluate(() =>
      window.__TEXTURE_STACK_DEBUG__!.readPixelAtUV(0.5, 0.5)
    );
    expect(contrastPx).not.toEqual(basePx);
    await page.getByTestId('reset-contrast-btn').click();
    expect(
      await page.evaluate(() =>
        window.__TEXTURE_STACK_DEBUG__!.readPixelAtUV(0.5, 0.5)
      )
    ).toEqual(basePx);

    // Smooth blend toggle & reset
    await page.getByTestId('param-smoothBlend-toggle').click();
    const hardPx = await page.evaluate(() =>
      window.__TEXTURE_STACK_DEBUG__!.readPixelAtUV(0.5, 0.5)
    );
    expect(hardPx).not.toEqual(basePx);
    await page.getByTestId('reset-smoothBlend-btn').click();
    expect(
      await page.evaluate(() =>
        window.__TEXTURE_STACK_DEBUG__!.readPixelAtUV(0.5, 0.5)
      )
    ).toEqual(basePx);

    // Invert control toggle & reset
    await page.getByTestId('param-invertControl-toggle').click();
    const invCtrlPx = await page.evaluate(() =>
      window.__TEXTURE_STACK_DEBUG__!.readPixelAtUV(0.5, 0.5)
    );
    expect(invCtrlPx).not.toEqual(basePx);
    await page.getByTestId('reset-invertControl-btn').click();
    expect(
      await page.evaluate(() =>
        window.__TEXTURE_STACK_DEBUG__!.readPixelAtUV(0.5, 0.5)
      )
    ).toEqual(basePx);

    // Verify PNG snapshot is valid and matches working resolution 640x360 with opaque alpha
    const snapInfo = await page.evaluate(async () => {
      const dataUrl = window.__TEXTURE_STACK_DEBUG__!.captureSnapshotDataUrl();
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('Invalid snapshot PNG'));
        img.src = dataUrl;
      });
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(320, 180, 1, 1).data;
      return {
        startsPng: dataUrl.startsWith('data:image/png;base64,'),
        width: img.width,
        height: img.height,
        alpha: px[3],
      };
    });
    expect(snapInfo.startsPng).toBe(true);
    expect(snapInfo.width).toBe(640);
    expect(snapInfo.height).toBe(360);
    expect(snapInfo.alpha).toBe(255);

    // Visible UI error when exceeding 32 images (D2, D9)
    await page.evaluate(() => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      const layers = Array.from({ length: 35 }, () => ({
        width: 4,
        height: 4,
        data: new Uint8Array(4 * 4 * 4),
      }));
      api.setStackRaw(layers);
    });
    await expect(page.getByTestId('error-toast').first()).toBeVisible();
    await expect(page.getByTestId('error-message').first()).toContainText('32');
  });

  test('3. Offset animation with controlled clock (§3 & §8.2)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="render-canvas"]');

    // Reset all and test speed 0 keeps offset still
    await page.evaluate(() => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      api.resetGroup('all');
      api.setParam('offset', 0.25);
      api.setParam('animSpeed', 0);
      api.stepClock(2.0);
    });
    let offset = await page.evaluate(
      () => window.__TEXTURE_STACK_DEBUG__!.getState().params.offset
    );
    expect(offset).toBeCloseTo(0.25, 5);

    // Positive speed advances linearly and updates offset slider UI
    await page.evaluate(() => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      api.setParam('offset', 0.1);
      api.setParam('animSpeed', 0.2);
      api.stepClock(1.5); // 0.1 + 0.2 * 1.5 = 0.4
    });
    offset = await page.evaluate(
      () => window.__TEXTURE_STACK_DEBUG__!.getState().params.offset
    );
    expect(offset).toBeCloseTo(0.4, 4);
    await expect(page.getByTestId('param-offset-slider')).toHaveValue('0.4');

    // Negative speed runs backwards and wraps 0 -> 1
    await page.evaluate(() => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      api.setParam('offset', 0.1);
      api.setParam('animSpeed', -0.25);
      api.stepClock(1.0); // 0.1 - 0.25 = -0.15 -> wraps to 0.85
    });
    offset = await page.evaluate(
      () => window.__TEXTURE_STACK_DEBUG__!.getState().params.offset
    );
    expect(offset).toBeCloseTo(0.85, 4);

    // Dragging/setting slider continues from new position
    // (freeze speed first so the live RAF loop cannot race the UI drag between calls)
    await page.evaluate(() => {
      window.__TEXTURE_STACK_DEBUG__!.setParam('animSpeed', 0);
    });
    const offsetSlider = page.getByTestId('param-offset-slider');
    await offsetSlider.fill('0.5');
    await offsetSlider.dispatchEvent('input');
    await page.evaluate(() => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      api.setParam('animSpeed', 0.1);
      api.stepClock(1.0); // 0.5 + 0.1 = 0.6
    });
    offset = await page.evaluate(
      () => window.__TEXTURE_STACK_DEBUG__!.getState().params.offset
    );
    expect(offset).toBeCloseTo(0.6, 4);

    // Hidden tab pauses with no jump
    await page.evaluate(() => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      api.setTabHiddenSimulated(true);
      api.stepClock(10.0);
      api.setTabHiddenSimulated(false);
    });
    offset = await page.evaluate(
      () => window.__TEXTURE_STACK_DEBUG__!.getState().params.offset
    );
    expect(offset).toBeCloseTo(0.6, 4);

    // Reset-to-default on offset sets both offset and speed to 0
    await page.getByTestId('reset-offset-btn').click();
    const afterReset = await page.evaluate(() => {
      const s = window.__TEXTURE_STACK_DEBUG__!.getState().params;
      return { offset: s.offset, animSpeed: s.animSpeed };
    });
    expect(afterReset.offset).toBe(0);
    expect(afterReset.animSpeed).toBe(0);

    // Seamless cyclic wrap: pixel at offset=0.998 matches pixel at offset=0.002 within tolerance
    const wrapDiff = await page.evaluate(() => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      api.setParam('cyclic', 1);
      api.setParam('smoothBlend', 1);
      api.setParam('offset', 0.999);
      const pA = api.readPixelAtUV(0.5, 0.5);
      api.setParam('offset', 0.001);
      const pB = api.readPixelAtUV(0.5, 0.5);
      return Math.max(
        Math.abs(pA[0] - pB[0]),
        Math.abs(pA[1] - pB[1]),
        Math.abs(pA[2] - pB[2])
      );
    });
    expect(wrapDiff).toBeLessThanOrEqual(3);
  });

  test('5. Dual playback transports per input media (Figma "Progress Bar", D14) + video sync button (D15)', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="render-canvas"]');

    // Initial state: control = image, mask = none
    await expect(page.getByTestId('control-status-label')).toHaveText('Image');
    await expect(page.getByTestId('mask-status-label')).toHaveText('None');
    await expect(page.getByTestId('control-progress-bar')).toHaveClass(/is-static/);
    await expect(page.getByTestId('mask-progress-bar')).toHaveClass(/is-static/);
    await expect(page.getByTestId('control-time-label')).toBeHidden();
    await expect(page.getByTestId('mask-time-label')).toBeHidden();
    await expect(page.getByTestId('control-play-pause-btn')).toBeDisabled();
    const syncBtn = page.getByTestId('video-sync-btn');
    await expect(syncBtn).toBeDisabled();

    // Load control video: must become "Video Input" transport and start from the beginning (D15)
    await page.setInputFiles(
      '[data-testid="control-video-file-input"]',
      'Video/TestVideo1.mov'
    );
    await expect(page.getByTestId('control-status-label')).toHaveText('Video Input');
    await expect(page.getByTestId('control-play-pause-btn')).toBeEnabled();
    await expect(page.getByTestId('control-progress-bar')).not.toHaveClass(/is-static/);
    await expect(page.getByTestId('control-time-label')).toBeVisible();
    await expect(syncBtn).toBeEnabled();

    const t0 = await page.evaluate(
      () => window.__TEXTURE_STACK_DEBUG__!.getState().controlSource.currentTime
    );
    expect(t0).toBeLessThan(1.0);

    // Seek control video to ~70% via its own progress bar (control transport only, D14)
    const bar = page.getByTestId('control-progress-bar');
    const bb = await bar.boundingBox();
    expect(bb).toBeTruthy();
    await page.mouse.click(bb!.x + bb!.width * 0.7, bb!.y + bb!.height / 2);
    await page.waitForTimeout(300);
    const tMid = await page.evaluate(
      () => window.__TEXTURE_STACK_DEBUG__!.getState().controlSource.currentTime
    );
    expect(tMid).toBeGreaterThan(0.5);

    // Load mask video: mask becomes "Video Mask" transport and starts at 0,
    // control video must NOT reset
    await page.setInputFiles(
      '[data-testid="mask-video-file-input"]',
      'Video/TestVideo1.mov'
    );
    await expect(page.getByTestId('mask-status-label')).toHaveText('Video Mask');
    await expect(page.getByTestId('mask-play-pause-btn')).toBeEnabled();
    await page.waitForTimeout(250);
    const bothState = await page.evaluate(() => {
      const s = window.__TEXTURE_STACK_DEBUG__!.getState();
      return {
        c: s.controlSource.currentTime,
        m: s.maskSource.currentTime,
      };
    });
    expect(bothState.c).toBeGreaterThan(0.5);
    expect(bothState.m).toBeLessThan(1.0);

    // Screenshot: dual video transports with progress + time (Figma "Video Image")
    fs.mkdirSync(path.resolve('tests/screenshots'), { recursive: true });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.resolve('tests/screenshots/playback-dual-video.png'),
    });

    // Play/pause buttons act per transport: pausing mask does not pause control
    await page.getByTestId('mask-play-pause-btn').click();
    const pausedState = await page.evaluate(() => {
      const s = window.__TEXTURE_STACK_DEBUG__!.getState();
      return {
        controlPlaying: s.controlSource.playing,
        maskPlaying: s.maskSource.playing,
      };
    });
    expect(pausedState.maskPlaying).toBe(false);
    expect(pausedState.controlPlaying).toBe(true);

    // Sync button restarts ALL videos from the beginning (D15)
    await syncBtn.click();
    await page.waitForTimeout(200);
    const synced = await page.evaluate(() => {
      const s = window.__TEXTURE_STACK_DEBUG__!.getState();
      return {
        c: s.controlSource.currentTime,
        m: s.maskSource.currentTime,
        maskPlaying: s.maskSource.playing,
      };
    });
    expect(synced.c).toBeLessThan(1.0);
    expect(synced.m).toBeLessThan(1.0);
    expect(synced.maskPlaying).toBe(true);

    // Webcam transport: red track + "Live" label, no time display, play disabled (D14)
    await page.getByTestId('control-source-webcam').click();
    await expect(page.getByTestId('control-status-label')).toHaveText('Webcam');
    await expect(page.getByTestId('control-progress-bar')).toHaveClass(/is-live/);
    await expect(page.getByTestId('control-live-label')).toBeVisible();
    await expect(page.getByTestId('control-time-label')).toBeHidden();
    await expect(page.getByTestId('control-play-pause-btn')).toBeDisabled();
    // Mask video transport unaffected by control webcam switch
    await expect(page.getByTestId('mask-status-label')).toHaveText('Video Mask');

    // Screenshot: webcam "Live" red track + mask video transport (Figma "Webcam / Video Image")
    await page.screenshot({
      path: path.resolve('tests/screenshots/playback-webcam-live.png'),
    });
  });

  test('6. Webcam shows in input preview and thumbnails cover-crop (keep proportions)', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="render-canvas"]');

    // 6a. Webcam activation must populate the preview thumbnail (regression)
    await page.getByTestId('control-source-webcam').click();
    const thumbImg = page.getByTestId('control-thumbnail');
    await expect(thumbImg).toBeVisible();
    // Thumbnail must contain real camera content (not a black/empty frame):
    const thumbInfo = await page.evaluate(() => {
      const url =
        window.__TEXTURE_STACK_DEBUG__!.getState().controlSource.thumbnailUrl;
      return new Promise<{ r: number; g: number; b: number; w: number }>(
        (resolve) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext('2d')!;
            ctx.drawImage(img, 0, 0);
            const px = ctx.getImageData(
              Math.floor(img.width / 2),
              Math.floor(img.height / 2),
              1,
              1
            ).data;
            resolve({ r: px[0], g: px[1], b: px[2], w: img.width });
          };
          img.src = url;
        }
      );
    });
    // Fake webcam frames are green-dominant; an empty capture would be ~black
    expect(thumbInfo.w).toBeGreaterThan(0);
    expect(thumbInfo.g).toBeGreaterThan(80);

    // 6b. Non-square images must be cover-cropped, not stretched (proportions kept)
    // Pattern: red field with blue strips on the extreme left/right edges of a 4:1 image.
    // Cover-crop to a square samples only the middle => edges (blue) are cropped out.
    // Stretching would keep the blue edges visible in the thumbnail.
    const b64 = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 128;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(0, 0, 32, 128); // left edge strip
      ctx.fillRect(480, 0, 32, 128); // right edge strip
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.setInputFiles('[data-testid="control-image-file-input"]', {
      name: 'wide-edges.png',
      mimeType: 'image/png',
      buffer: Buffer.from(b64, 'base64'),
    });
    // Wait deterministically for the image source to become active (webcam -> image switch)
    await page.waitForFunction(
      () =>
        window.__TEXTURE_STACK_DEBUG__!.getState().controlSource.mode ===
          'image' &&
        window.__TEXTURE_STACK_DEBUG__!.getState().controlSource.name ===
          'wide-edges.png'
    );

    const edgeSample = await page.evaluate(() => {
      const url =
        window.__TEXTURE_STACK_DEBUG__!.getState().controlSource.thumbnailUrl;
      return new Promise<{ left: number[]; center: number[]; sq: boolean }>(
        (resolve) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext('2d')!;
            ctx.drawImage(img, 0, 0);
            const left = Array.from(
              ctx.getImageData(2, Math.floor(img.height / 2), 1, 1).data
            );
            const center = Array.from(
              ctx.getImageData(
                Math.floor(img.width / 2),
                Math.floor(img.height / 2),
                1,
                1
              ).data
            );
            resolve({ left, center, sq: img.width === img.height });
          };
          img.src = url;
        }
      );
    });
    expect(edgeSample.sq).toBe(true);
    // Left edge must be the red field (blue strips cropped away), not blue (stretched)
    expect(edgeSample.left[0]).toBeGreaterThan(200);
    expect(edgeSample.left[2]).toBeLessThan(60);
    expect(edgeSample.center[0]).toBeGreaterThan(200);
  });

  test('4. Production build serves cleanly from root and subfolder + captures review screenshots & perf metrics', async ({
    page,
  }) => {
    // Capture screenshots of default state, ?demo=1 with stats overlay, and empty mask/stack state
    await page.goto('/?demo=1');
    await page.waitForSelector('[data-testid="render-canvas"]');
    await page.waitForTimeout(400);

    // Toggle stats overlay on and measure 16-layer 1280x720 performance
    await page.getByTestId('stats-toggle-btn').click();
    await expect(page.getByTestId('stats-overlay')).toBeVisible();

    const perfMetrics = await page.evaluate(() => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      api.setWorkingResolution(1280, 720);
      const t0 = performance.now();
      const frames = 20;
      for (let i = 0; i < frames; i++) {
        api.stepClock(1 / 60);
      }
      const totalMs = performance.now() - t0;
      return {
        avgFrameMs: Number((totalMs / frames).toFixed(2)),
        glErrors: api.getGlErrors(),
        stackLoaded: api.getState().stack.length,
      };
    });
    expect(perfMetrics.glErrors).toEqual([]);
    expect(perfMetrics.stackLoaded).toBeGreaterThan(0);

    fs.mkdirSync(path.resolve('tests/screenshots'), { recursive: true });
    await page.screenshot({
      path: path.resolve('tests/screenshots/demo-16-9-stats.png'),
    });

    // Test switching between Video and Image control source without page reload (D1)
    const initialLoadTimestamp = await page.evaluate(() => {
      (window as unknown as { __LOAD_MARKER__: number }).__LOAD_MARKER__ = 12345;
      return 12345;
    });
    await page.getByTestId('control-source-video').click();
    await page.waitForTimeout(150);
    const modeAfterVideoClick = await page.evaluate(
      () => window.__TEXTURE_STACK_DEBUG__!.getState().controlSource.mode
    );
    expect(modeAfterVideoClick).toBe('video');

    await page.getByTestId('control-source-image').click();
    const modeAfterImageClick = await page.evaluate(
      () => window.__TEXTURE_STACK_DEBUG__!.getState().controlSource.mode
    );
    const markerAfterSwitch = await page.evaluate(
      () => (window as unknown as { __LOAD_MARKER__: number }).__LOAD_MARKER__
    );
    expect(modeAfterImageClick).toBe('image');
    expect(markerAfterSwitch).toBe(initialLoadTimestamp);

    // Screenshot 2: 1:1 square working resolution (1024x1024, matching Figma Desktop - 1:1)
    await page.evaluate(() => {
      const api = window.__TEXTURE_STACK_DEBUG__!;
      api.setWorkingResolution(1024, 1024);
      api.setParam('offset', 0.35);
    });
    await page.screenshot({
      path: path.resolve('tests/screenshots/demo-1-1.png'),
    });

    // Screenshot 3: Empty stack / empty mask state (matching Figma Empty sources)
    await page.getByTestId('stack-clear-btn').click();
    await page.getByTestId('mask-clear-btn').click();
    await page.screenshot({
      path: path.resolve('tests/screenshots/empty-sources.png'),
    });

    fs.writeFileSync(
      path.resolve('tests/screenshots/perf.json'),
      JSON.stringify(perfMetrics, null, 2)
    );

    // Also test serving production `dist/` from a `/subpath/` prefix if `dist/` exists
    const distDir = path.resolve('dist');
    if (fs.existsSync(path.join(distDir, 'index.html'))) {
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.mov': 'video/quicktime',
      };

      const server = http.createServer((req, res) => {
        const urlPath = (req.url || '/').split('?')[0];
        const prefix = '/subfolder';
        if (!urlPath.startsWith(prefix)) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        let rel = urlPath.slice(prefix.length) || '/index.html';
        if (rel === '/') rel = '/index.html';
        const filePath = path.join(distDir, rel);
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.writeHead(404);
          res.end('Missing');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        });
        fs.createReadStream(filePath).pipe(res);
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address() as { port: number };
      const subErrors: string[] = [];
      page.on('pageerror', (err) => subErrors.push(err.message));

      try {
        await page.goto(`http://127.0.0.1:${addr.port}/subfolder/`);
        await page.waitForSelector('[data-testid="render-canvas"]');
        expect(subErrors).toEqual([]);
      } finally {
        server.close();
      }
    }
  });
});
