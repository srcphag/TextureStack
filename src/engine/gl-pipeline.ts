import fullscreenVertSrc from '../shaders/fullscreen.vert?raw';
import stackFragSrc from '../shaders/texture_stack3_web.frag?raw';
import fxFragSrc from '../shaders/fx_passthrough.frag?raw';
import {
  DEFAULT_WORKING_HEIGHT,
  DEFAULT_WORKING_WIDTH,
  MAX_STACK_LAYERS,
  RawTextureInput,
  ShaderParams,
} from './types';
import { flattenOverBlackRGBA } from './reference-cpu';

export class WebGLPipeline {
  public readonly canvas: HTMLCanvasElement;
  public readonly gl: WebGL2RenderingContext;

  private stackProgram: WebGLProgram;
  private fxProgram: WebGLProgram;
  private emptyVao: WebGLVertexArrayObject;

  private controlTex: WebGLTexture;
  private maskTex: WebGLTexture;
  private fallbackMaskTex: WebGLTexture;
  private stackTex: WebGLTexture | null = null;

  private fbo: WebGLFramebuffer;
  private fboTex: WebGLTexture;

  private workingWidth: number = DEFAULT_WORKING_WIDTH;
  private workingHeight: number = DEFAULT_WORKING_HEIGHT;
  private allocatedStackLayers = 0;
  private hasMaskLoaded = false;

  private fitCanvas: HTMLCanvasElement;
  private fitCtx: CanvasRenderingContext2D;

  private stackLocs: {
    uControl: WebGLUniformLocation | null;
    uMask: WebGLUniformLocation | null;
    uStack: WebGLUniformLocation | null;
    uNumImages: WebGLUniformLocation | null;
    uSmoothBlend: WebGLUniformLocation | null;
    uMaskInfluence: WebGLUniformLocation | null;
    uInvertMask: WebGLUniformLocation | null;
    uMaskMin: WebGLUniformLocation | null;
    uMaskMax: WebGLUniformLocation | null;
    uContrast: WebGLUniformLocation | null;
    uOffset: WebGLUniformLocation | null;
    uCyclic: WebGLUniformLocation | null;
    uInvertControl: WebGLUniformLocation | null;
  };

  private fxLocs: {
    uScene: WebGLUniformLocation | null;
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    });
    if (!gl) {
      throw new Error('WebGL2 is not supported by your browser or GPU.');
    }
    this.gl = gl;

    // Keep consistent top-down texture row order across DOM elements and Uint8Arrays
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    this.stackProgram = this.createProgram(fullscreenVertSrc, stackFragSrc);
    this.fxProgram = this.createProgram(fullscreenVertSrc, fxFragSrc);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create WebGL2 VertexArrayObject.');
    this.emptyVao = vao;

    this.stackLocs = {
      uControl: gl.getUniformLocation(this.stackProgram, 'uControl'),
      uMask: gl.getUniformLocation(this.stackProgram, 'uMask'),
      uStack: gl.getUniformLocation(this.stackProgram, 'uStack'),
      uNumImages: gl.getUniformLocation(this.stackProgram, 'uNumImages'),
      uSmoothBlend: gl.getUniformLocation(this.stackProgram, 'uSmoothBlend'),
      uMaskInfluence: gl.getUniformLocation(this.stackProgram, 'uMaskInfluence'),
      uInvertMask: gl.getUniformLocation(this.stackProgram, 'uInvertMask'),
      uMaskMin: gl.getUniformLocation(this.stackProgram, 'uMaskMin'),
      uMaskMax: gl.getUniformLocation(this.stackProgram, 'uMaskMax'),
      uContrast: gl.getUniformLocation(this.stackProgram, 'uContrast'),
      uOffset: gl.getUniformLocation(this.stackProgram, 'uOffset'),
      uCyclic: gl.getUniformLocation(this.stackProgram, 'uCyclic'),
      uInvertControl: gl.getUniformLocation(this.stackProgram, 'uInvertControl'),
    };

    this.fxLocs = {
      uScene: gl.getUniformLocation(this.fxProgram, 'uScene'),
    };

    this.controlTex = this.create2DTexture(gl.NEAREST);
    this.maskTex = this.create2DTexture(gl.NEAREST);
    this.fallbackMaskTex = this.create2DTexture(gl.NEAREST);

    // Initialize 1x1 default white fallback mask and mid-grey control texture
    this.uploadRaw2D(
      this.fallbackMaskTex,
      1,
      1,
      new Uint8Array([255, 255, 255, 255])
    );
    this.uploadRaw2D(
      this.controlTex,
      1,
      1,
      new Uint8Array([128, 128, 128, 255])
    );

    const fbo = gl.createFramebuffer();
    const fboTex = this.create2DTexture(gl.NEAREST);
    if (!fbo) throw new Error('Failed to create FX stage framebuffer.');
    this.fbo = fbo;
    this.fboTex = fboTex;

    this.fitCanvas = document.createElement('canvas');
    const ctx = this.fitCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Failed to create 2D offscreen canvas context.');
    this.fitCtx = ctx;

    this.setWorkingResolution(DEFAULT_WORKING_WIDTH, DEFAULT_WORKING_HEIGHT);
    // Initialize a 1-layer black stack so the shader always has a valid TEXTURE_2D_ARRAY bound
    this.allocateStackArray(1);
    this.uploadStackLayerRaw(
      0,
      new Uint8Array(this.workingWidth * this.workingHeight * 4)
    );
  }

  private compileShader(type: number, source: string): WebGLShader {
    const { gl } = this;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Unable to allocate WebGL shader.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) || 'Unknown shader compile error';
      gl.deleteShader(shader);
      throw new Error(`Shader compilation failed: ${info}`);
    }
    return shader;
  }

  private createProgram(vsSource: string, fsSource: string): WebGLProgram {
    const { gl } = this;
    const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    if (!prog) throw new Error('Unable to create WebGL program.');
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(prog) || 'Unknown program link error';
      gl.deleteProgram(prog);
      throw new Error(`Shader program link failed: ${info}`);
    }
    return prog;
  }

  private create2DTexture(filter: number): WebGLTexture {
    const { gl } = this;
    const tex = gl.createTexture();
    if (!tex) throw new Error('Failed to allocate WebGL texture.');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  public setWorkingResolution(width: number, height: number): void {
    const { gl } = this;
    const w = Math.max(1, Math.min(4096, Math.round(width)));
    const h = Math.max(1, Math.min(4096, Math.round(height)));
    this.workingWidth = w;
    this.workingHeight = h;

    this.canvas.width = w;
    this.canvas.height = h;

    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      w,
      h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.fboTex,
      0
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`FX framebuffer incomplete (status 0x${status.toString(16)}).`);
    }
  }

  public getWorkingResolution(): { width: number; height: number } {
    return { width: this.workingWidth, height: this.workingHeight };
  }

  /**
   * Cover-fit an HTMLImageElement or HTMLCanvasElement to workingWidth x workingHeight,
   * flattening any transparency over solid black (#000000) per D4 & D13.
   */
  public coverFitAndFlattenOverBlack(
    source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
    srcW: number,
    srcH: number
  ): Uint8Array {
    const W = this.workingWidth;
    const H = this.workingHeight;
    this.fitCanvas.width = W;
    this.fitCanvas.height = H;
    const ctx = this.fitCtx;

    // Fill solid opaque black first so any transparent pixels flatten over black (D13)
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);

    if (srcW > 0 && srcH > 0) {
      const scale = Math.max(W / srcW, H / srcH);
      const dw = srcW * scale;
      const dh = srcH * scale;
      const dx = (W - dw) / 2;
      const dy = (H - dh) / 2;
      ctx.drawImage(source, dx, dy, dw, dh);
    }

    const imgData = ctx.getImageData(0, 0, W, H);
    // Ensure alpha byte is strictly 255 everywhere
    const out = new Uint8Array(imgData.data.buffer.slice(0));
    for (let i = 3; i < out.length; i += 4) {
      out[i] = 255;
    }
    return out;
  }

  /**
   * Cover-fit a RawTextureInput (RGBA8) on CPU to workingWidth x workingHeight
   * and flatten transparency over black (D4 & D13).
   */
  public coverFitRawAndFlattenOverBlack(tex: RawTextureInput): Uint8Array {
    const flattened = flattenOverBlackRGBA(tex.data);
    const W = this.workingWidth;
    const H = this.workingHeight;
    if (tex.width === W && tex.height === H) {
      return flattened;
    }
    const out = new Uint8Array(W * H * 4);
    const scale = Math.max(W / tex.width, H / tex.height);
    const dw = tex.width * scale;
    const dh = tex.height * scale;
    const ox = (W - dw) / 2;
    const oy = (H - dh) / 2;

    for (let y = 0; y < H; y++) {
      const sy = Math.min(
        tex.height - 1,
        Math.max(0, Math.floor((y + 0.5 - oy) / scale))
      );
      for (let x = 0; x < W; x++) {
        const sx = Math.min(
          tex.width - 1,
          Math.max(0, Math.floor((x + 0.5 - ox) / scale))
        );
        const sIdx = (sy * tex.width + sx) * 4;
        const dIdx = (y * W + x) * 4;
        out[dIdx] = flattened[sIdx];
        out[dIdx + 1] = flattened[sIdx + 1];
        out[dIdx + 2] = flattened[sIdx + 2];
        out[dIdx + 3] = 255;
      }
    }
    return out;
  }

  public allocateStackArray(numLayers: number): void {
    const { gl } = this;
    const count = Math.max(1, Math.min(MAX_STACK_LAYERS, numLayers));
    if (this.stackTex) {
      gl.deleteTexture(this.stackTex);
      this.stackTex = null;
    }
    const tex = gl.createTexture();
    if (!tex) throw new Error('Failed to allocate TEXTURE_2D_ARRAY for stack.');
    this.stackTex = tex;
    this.allocatedStackLayers = count;

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.RGBA8,
      this.workingWidth,
      this.workingHeight,
      count,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );

    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      throw new Error(
        `GPU memory allocation failed for ${count} layers at ${this.workingWidth}×${this.workingHeight} (GL error 0x${err.toString(16)}).`
      );
    }
  }

  public uploadStackLayerRaw(layerIndex: number, rgbaData: Uint8Array): void {
    const { gl } = this;
    if (!this.stackTex || layerIndex < 0 || layerIndex >= this.allocatedStackLayers) {
      return;
    }
    const expectedLen = this.workingWidth * this.workingHeight * 4;
    if (rgbaData.length !== expectedLen) {
      throw new Error(
        `Stack layer ${layerIndex} buffer size mismatch: got ${rgbaData.length}, expected ${expectedLen}.`
      );
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.stackTex);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layerIndex,
      this.workingWidth,
      this.workingHeight,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rgbaData
    );
  }

  public uploadRaw2D(
    tex: WebGLTexture,
    width: number,
    height: number,
    data: Uint8Array | Uint8ClampedArray
  ): void {
    const { gl } = this;
    const flattened = flattenOverBlackRGBA(data);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      flattened
    );
  }

  public uploadControlRaw(tex: RawTextureInput): void {
    this.uploadRaw2D(this.controlTex, tex.width, tex.height, tex.data);
  }

  public uploadControlElement(
    el: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
    width: number,
    height: number
  ): void {
    const { gl } = this;
    if (width <= 0 || height <= 0) return;
    // Flatten over black in 2D canvas if image/canvas, or upload directly if video
    if (el instanceof HTMLVideoElement) {
      gl.bindTexture(gl.TEXTURE_2D, this.controlTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, el);
    } else {
      this.fitCanvas.width = width;
      this.fitCanvas.height = height;
      this.fitCtx.fillStyle = '#000000';
      this.fitCtx.fillRect(0, 0, width, height);
      this.fitCtx.drawImage(el, 0, 0, width, height);
      gl.bindTexture(gl.TEXTURE_2D, this.controlTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.fitCanvas
      );
    }
  }

  public uploadMaskRaw(tex: RawTextureInput | null): void {
    if (!tex) {
      this.hasMaskLoaded = false;
      return;
    }
    this.hasMaskLoaded = true;
    this.uploadRaw2D(this.maskTex, tex.width, tex.height, tex.data);
  }

  public uploadMaskElement(
    el: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | null,
    width: number,
    height: number
  ): void {
    const { gl } = this;
    if (!el || width <= 0 || height <= 0) {
      this.hasMaskLoaded = false;
      return;
    }
    this.hasMaskLoaded = true;
    if (el instanceof HTMLVideoElement) {
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, el);
    } else {
      this.fitCanvas.width = width;
      this.fitCanvas.height = height;
      this.fitCtx.fillStyle = '#000000';
      this.fitCtx.fillRect(0, 0, width, height);
      this.fitCtx.drawImage(el, 0, 0, width, height);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.fitCanvas
      );
    }
  }

  public render(params: ShaderParams, loadedStackCount: number): void {
    const { gl } = this;
    const W = this.workingWidth;
    const H = this.workingHeight;

    const effectiveNumImages = Math.max(
      1,
      Math.min(
        Math.floor(params.numImages),
        Math.max(1, loadedStackCount),
        this.allocatedStackLayers
      )
    );
    const effectiveMaskInfluence = this.hasMaskLoaded
      ? Math.max(0, Math.min(1, params.maskInfluence))
      : 0.0;

    gl.bindVertexArray(this.emptyVao);

    // --- PASS 1: Stack shader -> FX FBO (D5) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.stackProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.controlTex);
    gl.uniform1i(this.stackLocs.uControl, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(
      gl.TEXTURE_2D,
      this.hasMaskLoaded ? this.maskTex : this.fallbackMaskTex
    );
    gl.uniform1i(this.stackLocs.uMask, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.stackTex);
    gl.uniform1i(this.stackLocs.uStack, 2);

    gl.uniform1i(this.stackLocs.uNumImages, effectiveNumImages);
    gl.uniform1f(this.stackLocs.uSmoothBlend, params.smoothBlend >= 0.5 ? 1.0 : 0.0);
    gl.uniform1f(this.stackLocs.uMaskInfluence, effectiveMaskInfluence);
    gl.uniform1f(this.stackLocs.uInvertMask, params.invertMask >= 0.5 ? 1.0 : 0.0);
    gl.uniform1f(this.stackLocs.uMaskMin, params.maskMin);
    gl.uniform1f(this.stackLocs.uMaskMax, params.maskMax);
    gl.uniform1f(this.stackLocs.uContrast, params.contrast);
    gl.uniform1f(this.stackLocs.uOffset, params.offset);
    gl.uniform1f(this.stackLocs.uCyclic, params.cyclic >= 0.5 ? 1.0 : 0.0);
    gl.uniform1f(this.stackLocs.uInvertControl, params.invertControl >= 0.5 ? 1.0 : 0.0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // --- PASS 2: FX Stage (pass-through in v1) -> Screen Canvas (D5) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.fxProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.uniform1i(this.fxLocs.uScene, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /**
   * Read pixels in top-to-bottom row order (matching image/UV coordinates where y=0 is top).
   * Reading from the FX FBO (or flipping screen canvas rows) yields identical pixels in v1.
   * Here we read from the final screen framebuffer and flip Y so we verify the complete
   * 2-pass pipeline (Stack shader -> FBO -> FX stage -> Screen Canvas).
   */
  public readPixelsTopDown(
    x: number = 0,
    y: number = 0,
    width: number = this.workingWidth,
    height: number = this.workingHeight
  ): Uint8Array {
    const { gl } = this;
    const raw = new Uint8Array(width * height * 4);
    // In WebGL screen framebuffer, row 0 is at the bottom, so y_gl = (workingHeight - y - height)
    const glY = Math.max(0, this.workingHeight - y - height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(x, glY, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);

    // Flip rows so row 0 of returned buffer is the visual top row (y=0)
    const out = new Uint8Array(width * height * 4);
    const rowBytes = width * 4;
    for (let r = 0; r < height; r++) {
      const srcRow = height - 1 - r;
      out.set(
        raw.subarray(srcRow * rowBytes, (srcRow + 1) * rowBytes),
        r * rowBytes
      );
    }
    return out;
  }

  public drainGlErrors(): number[] {
    const { gl } = this;
    const errs: number[] = [];
    let e = gl.getError();
    while (e !== gl.NO_ERROR && errs.length < 16) {
      errs.push(e);
      e = gl.getError();
    }
    return errs;
  }
}
