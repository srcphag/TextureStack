import { RawTextureInput } from './types';

/**
 * Create a solid color RGBA8 texture.
 */
export function makeSolidTexture(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a: number = 255
): RawTextureInput {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { width, height, data };
}

/**
 * Create a horizontal luminance ramp (x=0 -> 0, x=width-1 -> 255).
 */
export function makeHorizontalRampTexture(
  width: number,
  height: number
): RawTextureInput {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = width > 1 ? Math.round((x / (width - 1)) * 255) : 0;
      const idx = (y * width + x) * 4;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = 255;
    }
  }
  return { width, height, data };
}

/**
 * Create a radial/wave gradient control map for default/demo display.
 */
export function makeDemoControlTexture(
  width: number,
  height: number
): RawTextureInput {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / Math.max(1, width - 1);
      const dx = u - 0.5;
      const dy = v - 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy) * 1.4;
      const wave = 0.5 + 0.5 * Math.sin((u * 2.0 + v * 1.5) * Math.PI * 2);
      const val = Math.max(0, Math.min(1, 0.6 * (1 - dist) + 0.4 * wave));
      const c = Math.round(val * 255);
      const idx = (y * width + x) * 4;
      data[idx] = c;
      data[idx + 1] = c;
      data[idx + 2] = c;
      data[idx + 3] = 255;
    }
  }
  return { width, height, data };
}

/**
 * Create a set of distinct colored/patterned stack layers for initial/demo state.
 */
export function makeDistinctStackLayers(
  count: number,
  width: number,
  height: number
): { tex: RawTextureInput; name: string }[] {
  const palette: [number, number, number][] = [
    [20, 40, 90],
    [40, 120, 190],
    [80, 210, 230],
    [90, 235, 150],
    [240, 220, 95],
    [245, 130, 70],
    [220, 60, 90],
    [150, 70, 200],
  ];
  const out: { tex: RawTextureInput; name: string }[] = [];
  for (let i = 0; i < count; i++) {
    const [r, g, b] = palette[i % palette.length];
    const mod = Math.floor(i / palette.length) * 17;
    const rr = (r + mod) % 256;
    const gg = (g + mod * 2) % 256;
    const bb = (b + mod * 3) % 256;
    out.push({
      tex: makeSolidTexture(width, height, rr, gg, bb, 255),
      name: `layer_${String(i + 1).padStart(2, '0')}.png`,
    });
  }
  return out;
}

/**
 * Convert a RawTextureInput into a square PNG thumbnail data URL for UI previews.
 * Cover-crops to keep proportions (crops overflow, like stack layers, D4).
 */
export function rawTextureToThumbnailUrl(
  tex: RawTextureInput,
  maxThumbSize: number = 96
): string {
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = tex.width;
  srcCanvas.height = tex.height;
  const sctx = srcCanvas.getContext('2d');
  if (!sctx) return '';
  const imgData = sctx.createImageData(tex.width, tex.height);
  imgData.data.set(tex.data);
  sctx.putImageData(imgData, 0, 0);

  const size = maxThumbSize;
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = size;
  dstCanvas.height = size;
  const dctx = dstCanvas.getContext('2d');
  if (!dctx) return '';
  dctx.fillStyle = '#000000';
  dctx.fillRect(0, 0, size, size);
  if (tex.width > 0 && tex.height > 0) {
    const scale = Math.max(size / tex.width, size / tex.height);
    const dw = tex.width * scale;
    const dh = tex.height * scale;
    dctx.drawImage(srcCanvas, (size - dw) / 2, (size - dh) / 2, dw, dh);
  }
  return dstCanvas.toDataURL('image/png');
}
