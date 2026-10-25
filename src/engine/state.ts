import { AnimationClock, advanceOffsetLinear } from './clock';
import {
  makeDemoControlTexture,
  makeDistinctStackLayers,
  rawTextureToThumbnailUrl,
} from './fixtures';
import { WebGLPipeline } from './gl-pipeline';
import {
  AppError,
  AppState,
  DEFAULT_SHADER_PARAMS,
  DEFAULT_WORKING_HEIGHT,
  DEFAULT_WORKING_WIDTH,
  MAX_STACK_LAYERS,
  MediaSourceState,
  RawTextureInput,
  ShaderParams,
  SourceMode,
  StackLayerItem,
} from './types';

interface StoredSlotMedia {
  imageElement: HTMLImageElement | HTMLCanvasElement | null;
  imageRaw: RawTextureInput | null;
  imageName: string;
  imageThumb: string;

  videoElement: HTMLVideoElement | null;
  videoUrl: string | null;
  videoName: string;
  videoThumb: string;

  webcamVideo: HTMLVideoElement | null;
  webcamStream: MediaStream | null;
}

function createEmptySlotMedia(): StoredSlotMedia {
  return {
    imageElement: null,
    imageRaw: null,
    imageName: '',
    imageThumb: '',
    videoElement: null,
    videoUrl: null,
    videoName: '',
    videoThumb: '',
    webcamVideo: null,
    webcamStream: null,
  };
}

function createEmptyMediaSourceState(): MediaSourceState {
  return {
    mode: 'none',
    name: '',
    width: 0,
    height: 0,
    thumbnailUrl: '',
    playing: false,
    currentTime: 0,
    duration: 0,
  };
}

export class TextureStackEngine {
  public readonly pipeline: WebGLPipeline;
  private readonly clock: AnimationClock = new AnimationClock();

  private state: AppState;
  private listeners: Set<(state: AppState) => void> = new Set();

  private controlMedia: StoredSlotMedia = createEmptySlotMedia();
  private maskMedia: StoredSlotMedia = createEmptySlotMedia();

  private rafId: number | null = null;
  private lastFrameRenderMs = performance.now();
  private smoothedFps = 60;
  private smoothedFrameMs = 16.7;
  private nextIdCounter = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.pipeline = new WebGLPipeline(canvas);

    this.state = {
      params: { ...DEFAULT_SHADER_PARAMS },
      workingWidth: DEFAULT_WORKING_WIDTH,
      workingHeight: DEFAULT_WORKING_HEIGHT,
      stack: [],
      controlSource: createEmptyMediaSourceState(),
      maskSource: createEmptyMediaSourceState(),
      hasMask: false,
      errors: [],
      statsVisible: false,
      fps: 0,
      frameTimeMs: 0,
      frameCount: 0,
    };

    document.addEventListener('visibilitychange', () => {
      this.clock.setHidden(document.visibilityState === 'hidden');
      this.ensureLoopState();
    });
  }

  private genId(prefix: string): string {
    return `${prefix}_${this.nextIdCounter++}`;
  }

  public subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.getState();
    for (const fn of this.listeners) {
      fn(snap);
    }
  }

  public getState(): AppState {
    return {
      ...this.state,
      params: { ...this.state.params },
      stack: [...this.state.stack],
      controlSource: { ...this.state.controlSource },
      maskSource: { ...this.state.maskSource },
      errors: [...this.state.errors],
    };
  }

  public addError(message: string): void {
    const err: AppError = {
      id: this.genId('err'),
      message,
      timestamp: Date.now(),
    };
    this.state.errors = [err, ...this.state.errors].slice(0, 5);
    this.emit();
  }

  public dismissError(id: string): void {
    this.state.errors = this.state.errors.filter((e) => e.id !== id);
    this.emit();
  }

  public clearErrors(): void {
    this.state.errors = [];
    this.emit();
  }

  public toggleStats(visible?: boolean): void {
    this.state.statsVisible =
      visible !== undefined ? visible : !this.state.statsVisible;
    this.emit();
  }

  /**
   * Initialize default procedural scene (or `?demo=1` scene).
   */
  public initDefaultScene(): void {
    const ctrl = makeDemoControlTexture(256, 256);
    this.setControlRaw(ctrl, 'default_control_gradient.png');

    const layers = makeDistinctStackLayers(
      6,
      this.state.workingWidth,
      this.state.workingHeight
    );
    this.setStackRaw(
      layers.map((l) => l.tex),
      layers.map((l) => l.name)
    );
  }

  /**
   * Load demo assets from `/demo/manifest.json` if present, or fall back to rich generated demo scene.
   */
  public async loadDemoScene(): Promise<void> {
    this.initDefaultScene();
    this.setParam('animSpeed', 0.15);
    this.setParam('cyclic', 1);

    try {
      const resp = await fetch('./demo/manifest.json');
      if (resp.ok) {
        const manifest = (await resp.json()) as {
          controlImage?: string;
          controlVideo?: string;
          maskImage?: string;
          stackImages?: string[];
        };
        if (manifest.stackImages && manifest.stackImages.length > 0) {
          const imgs: { img: HTMLImageElement; name: string }[] = [];
          for (const rel of manifest.stackImages.slice(0, MAX_STACK_LAYERS)) {
            try {
              const img = await this.loadImageFromUrl(rel);
              const name = rel.split('/').pop() || rel;
              imgs.push({ img, name });
            } catch {
              // ignore missing optional demo image
            }
          }
          if (imgs.length > 0) {
            this.replaceStackWithImageElements(imgs);
          }
        }
        if (manifest.controlImage) {
          try {
            const img = await this.loadImageFromUrl(manifest.controlImage);
            this.setSlotImageElement(
              'control',
              img,
              manifest.controlImage.split('/').pop() || 'control.jpg'
            );
          } catch {
            // keep default control
          }
        }
        if (manifest.controlVideo) {
          try {
            await this.setSlotVideoUrl(
              'control',
              manifest.controlVideo,
              manifest.controlVideo.split('/').pop() || 'control.mp4',
              false // Preload video slot so user can switch 1-click between image & video
            );
          } catch {
            // optional
          }
        }
      }
    } catch {
      // Procedural demo already active
    }
  }

  private loadImageFromUrl(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }

  public setParam<K extends keyof ShaderParams>(
    key: K,
    value: ShaderParams[K]
  ): void {
    let v = Number(value);
    if (Number.isNaN(v)) return;

    switch (key) {
      case 'numImages': {
        const maxImgs = Math.max(1, this.state.stack.length);
        v = Math.max(1, Math.min(maxImgs, Math.round(v)));
        break;
      }
      case 'smoothBlend':
      case 'cyclic':
      case 'invertMask':
      case 'invertControl':
        v = v >= 0.5 ? 1 : 0;
        break;
      case 'contrast':
        v = Math.max(0, Math.min(4, v));
        break;
      case 'offset':
        v = Math.max(0, Math.min(1, v));
        break;
      case 'animSpeed':
        v = Math.max(-1, Math.min(1, v));
        this.clock.reset();
        break;
      case 'maskInfluence':
        v = this.state.hasMask ? Math.max(0, Math.min(1, v)) : 0;
        break;
      case 'maskMin':
      case 'maskMax':
        v = Math.max(0, Math.min(1, v));
        break;
    }

    this.state.params[key] = v as ShaderParams[K];
    this.renderNow();
    this.ensureLoopState();
    this.emit();
  }

  public resetParam(key: keyof ShaderParams): void {
    if (key === 'numImages') {
      this.setParam('numImages', Math.max(1, this.state.stack.length));
      return;
    }
    if (key === 'maskInfluence') {
      this.setParam('maskInfluence', this.state.hasMask ? 1 : 0);
      return;
    }
    if (key === 'offset') {
      this.state.params.offset = 0;
      this.state.params.animSpeed = 0;
      this.clock.reset();
      this.renderNow();
      this.ensureLoopState();
      this.emit();
      return;
    }
    this.setParam(key, DEFAULT_SHADER_PARAMS[key]);
  }

  public resetGroup(
    group: 'shader' | 'control' | 'mask' | 'animation' | 'all'
  ): void {
    if (group === 'shader' || group === 'all') {
      this.state.params.numImages = Math.max(1, this.state.stack.length);
      this.state.params.smoothBlend = DEFAULT_SHADER_PARAMS.smoothBlend;
    }
    if (group === 'control' || group === 'all') {
      this.state.params.contrast = DEFAULT_SHADER_PARAMS.contrast;
      this.state.params.offset = 0;
      this.state.params.animSpeed = 0;
      this.state.params.cyclic = DEFAULT_SHADER_PARAMS.cyclic;
      this.state.params.invertControl = DEFAULT_SHADER_PARAMS.invertControl;
      this.clock.reset();
    }
    if (group === 'animation') {
      this.state.params.offset = 0;
      this.state.params.animSpeed = 0;
      this.clock.reset();
    }
    if (group === 'mask' || group === 'all') {
      this.state.params.maskInfluence = this.state.hasMask ? 1 : 0;
      this.state.params.invertMask = DEFAULT_SHADER_PARAMS.invertMask;
      this.state.params.maskMin = DEFAULT_SHADER_PARAMS.maskMin;
      this.state.params.maskMax = DEFAULT_SHADER_PARAMS.maskMax;
    }
    this.renderNow();
    this.ensureLoopState();
    this.emit();
  }

  public setWorkingResolution(width: number, height: number): void {
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 1 ||
      height < 1 ||
      width > 4096 ||
      height > 4096
    ) {
      this.addError('Working resolution must be between 1×1 and 4096×4096.');
      return;
    }
    const w = Math.round(width);
    const h = Math.round(height);
    try {
      this.pipeline.setWorkingResolution(w, h);
      this.state.workingWidth = w;
      this.state.workingHeight = h;

      // Re-fit and re-upload all stack layers to the new working resolution (D4)
      for (const item of this.state.stack) {
        if (item.sourceElement) {
          item.rgbaData = this.pipeline.coverFitAndFlattenOverBlack(
            item.sourceElement,
            item.width,
            item.height
          );
        } else if (item.rgbaData) {
          item.rgbaData = this.pipeline.coverFitRawAndFlattenOverBlack({
            width: item.width,
            height: item.height,
            data: item.rgbaData,
          });
          item.width = w;
          item.height = h;
        }
      }
      this.syncStackToGPU();
      this.renderNow();
      this.emit();
    } catch (err) {
      this.addError(
        err instanceof Error ? err.message : 'Failed to change working resolution.'
      );
    }
  }

  private syncStackToGPU(): void {
    const count = Math.max(1, this.state.stack.length);
    this.pipeline.allocateStackArray(count);
    if (this.state.stack.length === 0) {
      this.pipeline.uploadStackLayerRaw(
        0,
        new Uint8Array(this.state.workingWidth * this.state.workingHeight * 4)
      );
      return;
    }
    this.state.stack.forEach((item, index) => {
      if (item.rgbaData) {
        this.pipeline.uploadStackLayerRaw(index, item.rgbaData);
      }
    });
  }

  public setStackRaw(layers: RawTextureInput[], names?: string[]): void {
    if (layers.length > MAX_STACK_LAYERS) {
      this.addError(
        `Maximum stack size is ${MAX_STACK_LAYERS} images. Only the first ${MAX_STACK_LAYERS} were loaded.`
      );
    }
    const capped = layers.slice(0, MAX_STACK_LAYERS);
    this.state.stack = capped.map((tex, i) => {
      const fitted = this.pipeline.coverFitRawAndFlattenOverBlack(tex);
      return {
        id: this.genId('layer'),
        name: names?.[i] ?? `layer_${i + 1}.png`,
        width: this.state.workingWidth,
        height: this.state.workingHeight,
        thumbnailUrl: rawTextureToThumbnailUrl(tex),
        rgbaData: fitted,
      };
    });
    this.state.params.numImages = Math.max(1, this.state.stack.length);
    this.syncStackToGPU();
    this.renderNow();
    this.emit();
  }

  public loadStackImageWithAlpha(
    width: number,
    height: number,
    rgba: Uint8Array,
    name: string = 'alpha_layer.png'
  ): void {
    const tex: RawTextureInput = { width, height, data: rgba };
    this.setStackRaw([tex], [name]);
  }

  private createElementThumbnail(
    el: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
    srcW: number,
    srcH: number
  ): string {
    // Square cover-crop: keeps source proportions, crops overflow (like stack layers, D4)
    const size = 96;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    if (srcW > 0 && srcH > 0) {
      const scale = Math.max(size / srcW, size / srcH);
      const dw = srcW * scale;
      const dh = srcH * scale;
      ctx.drawImage(el, (size - dw) / 2, (size - dh) / 2, dw, dh);
    }
    return c.toDataURL('image/png');
  }

  public replaceStackWithImageElements(
    items: { img: HTMLImageElement; name: string }[]
  ): void {
    const capped = items.slice(0, MAX_STACK_LAYERS);
    this.state.stack = capped.map(({ img, name }) => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      return {
        id: this.genId('layer'),
        name,
        width: w,
        height: h,
        thumbnailUrl: this.createElementThumbnail(img, w, h),
        rgbaData: this.pipeline.coverFitAndFlattenOverBlack(img, w, h),
        sourceElement: img,
      };
    });
    this.state.params.numImages = Math.max(1, this.state.stack.length);
    this.syncStackToGPU();
    this.renderNow();
    this.emit();
  }

  public async addStackFiles(files: FileList | File[]): Promise<void> {
    const arr = Array.from(files);
    if (arr.length === 0) return;

    const remainingSlots = MAX_STACK_LAYERS - this.state.stack.length;
    if (remainingSlots <= 0) {
      this.addError(
        `Stack already has the maximum of ${MAX_STACK_LAYERS} images.`
      );
      return;
    }

    if (arr.length > remainingSlots) {
      this.addError(
        `Maximum stack size is ${MAX_STACK_LAYERS} images. Added ${remainingSlots} of ${arr.length} selected files.`
      );
    }

    const toLoad = arr.slice(0, remainingSlots);
    const wasAtMaxNumImages =
      this.state.stack.length === 0 ||
      this.state.params.numImages === this.state.stack.length;

    let addedAny = false;
    for (const file of toLoad) {
      if (!file.type.startsWith('image/')) {
        this.addError(`Unsupported stack file "${file.name}": must be an image.`);
        continue;
      }
      try {
        const img = await this.decodeImageFile(file);
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const fitted = this.pipeline.coverFitAndFlattenOverBlack(img, w, h);
        this.state.stack.push({
          id: this.genId('layer'),
          name: file.name,
          width: w,
          height: h,
          thumbnailUrl: this.createElementThumbnail(img, w, h),
          rgbaData: fitted,
          sourceElement: img,
        });
        addedAny = true;
      } catch {
        this.addError(`Failed to decode image "${file.name}".`);
      }
    }

    if (addedAny) {
      if (wasAtMaxNumImages) {
        this.state.params.numImages = this.state.stack.length;
      } else {
        this.state.params.numImages = Math.min(
          this.state.params.numImages,
          this.state.stack.length
        );
      }
      this.syncStackToGPU();
      this.renderNow();
      this.emit();
    }
  }

  public removeStackLayer(index: number): void {
    if (index < 0 || index >= this.state.stack.length) return;
    const wasAll = this.state.params.numImages >= this.state.stack.length;
    this.state.stack.splice(index, 1);
    if (wasAll) {
      this.state.params.numImages = Math.max(1, this.state.stack.length);
    } else {
      this.state.params.numImages = Math.max(
        1,
        Math.min(this.state.params.numImages, Math.max(1, this.state.stack.length))
      );
    }
    this.syncStackToGPU();
    this.renderNow();
    this.emit();
  }

  public reorderStackLayer(fromIndex: number, toIndex: number): void {
    if (
      fromIndex < 0 ||
      fromIndex >= this.state.stack.length ||
      toIndex < 0 ||
      toIndex >= this.state.stack.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const [moved] = this.state.stack.splice(fromIndex, 1);
    this.state.stack.splice(toIndex, 0, moved);
    this.syncStackToGPU();
    this.renderNow();
    this.emit();
  }

  public clearStack(): void {
    this.state.stack = [];
    this.state.params.numImages = 1;
    this.syncStackToGPU();
    this.renderNow();
    this.emit();
  }

  private decodeImageFile(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Invalid image file: ${file.name}`));
      };
      img.src = url;
    });
  }

  // --- CONTROL & MASK SOURCES ---

  public setControlRaw(
    tex: RawTextureInput,
    name: string = 'raw_control.png'
  ): void {
    const thumb = rawTextureToThumbnailUrl(tex);
    this.controlMedia.imageRaw = tex;
    this.controlMedia.imageElement = null;
    this.controlMedia.imageName = name;
    this.controlMedia.imageThumb = thumb;

    this.pipeline.uploadControlRaw(tex);
    this.state.controlSource = {
      mode: 'image',
      name,
      width: tex.width,
      height: tex.height,
      thumbnailUrl: thumb,
      playing: false,
      currentTime: 0,
      duration: 0,
    };
    this.renderNow();
    this.ensureLoopState();
    this.emit();
  }

  public setMaskRaw(
    tex: RawTextureInput | null,
    name: string = 'raw_mask.png'
  ): void {
    if (!tex) {
      this.clearMask();
      return;
    }
    const thumb = rawTextureToThumbnailUrl(tex);
    this.maskMedia.imageRaw = tex;
    this.maskMedia.imageElement = null;
    this.maskMedia.imageName = name;
    this.maskMedia.imageThumb = thumb;

    const wasEmpty = !this.state.hasMask;
    this.state.hasMask = true;
    if (wasEmpty) {
      this.state.params.maskInfluence = 1;
    }
    this.pipeline.uploadMaskRaw(tex);
    this.state.maskSource = {
      mode: 'image',
      name,
      width: tex.width,
      height: tex.height,
      thumbnailUrl: thumb,
      playing: false,
      currentTime: 0,
      duration: 0,
    };
    this.renderNow();
    this.ensureLoopState();
    this.emit();
  }

  public clearMask(): void {
    const slot = this.maskMedia;
    if (slot.videoElement) {
      slot.videoElement.pause();
    }
    if (slot.webcamStream) {
      slot.webcamStream.getTracks().forEach((t) => t.stop());
      slot.webcamStream = null;
    }
    this.state.hasMask = false;
    this.state.params.maskInfluence = 0; // Spec D11
    this.state.maskSource = createEmptyMediaSourceState();
    this.pipeline.uploadMaskRaw(null);
    this.renderNow();
    this.ensureLoopState();
    this.emit();
  }

  private setSlotImageElement(
    target: 'control' | 'mask',
    img: HTMLImageElement | HTMLCanvasElement,
    name: string
  ): void {
    const w = img instanceof HTMLImageElement ? img.naturalWidth || img.width : img.width;
    const h = img instanceof HTMLImageElement ? img.naturalHeight || img.height : img.height;
    const thumb = this.createElementThumbnail(img, w, h);
    const slot = target === 'control' ? this.controlMedia : this.maskMedia;
    slot.imageElement = img;
    slot.imageRaw = null;
    slot.imageName = name;
    slot.imageThumb = thumb;

    this.activateSlotMode(target, 'image');
  }

  public async loadSlotFile(
    target: 'control' | 'mask',
    file: File
  ): Promise<void> {
    if (file.type.startsWith('image/')) {
      try {
        const img = await this.decodeImageFile(file);
        this.setSlotImageElement(target, img, file.name);
      } catch {
        this.addError(`Unsupported or corrupted image file "${file.name}".`);
      }
      return;
    }

    if (
      file.type.startsWith('video/') ||
      /\.(mp4|mov|webm|ogg|m4v)$/i.test(file.name)
    ) {
      const url = URL.createObjectURL(file);
      try {
        await this.setSlotVideoUrl(target, url, file.name, true, true);
      } catch {
        URL.revokeObjectURL(url);
        this.addError(`Unsupported or unplayable video file "${file.name}".`);
      }
      return;
    }

    this.addError(
      `Unsupported file format "${file.name}". Please select an image or video file.`
    );
  }

  public async setSlotVideoUrl(
    target: 'control' | 'mask',
    url: string,
    name: string,
    activateImmediately: boolean = true,
    revokePreviousBlob: boolean = false
  ): Promise<void> {
    const slot = target === 'control' ? this.controlMedia : this.maskMedia;

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.loop = true; // Resolved §10 Q4: video files loop automatically
    video.playsInline = true;
    video.preload = 'auto';

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`Failed to load video: ${name}`));
      };
      const cleanup = () => {
        video.removeEventListener('loadeddata', onLoaded);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('loadeddata', onLoaded);
      video.addEventListener('error', onError);
      video.src = url;
      video.load();
    });

    if (slot.videoElement) {
      slot.videoElement.pause();
    }
    if (revokePreviousBlob && slot.videoUrl && slot.videoUrl.startsWith('blob:')) {
      URL.revokeObjectURL(slot.videoUrl);
    }

    // D15: newly loaded videos always start from the beginning
    video.currentTime = 0;

    slot.videoElement = video;
    slot.videoUrl = url;
    slot.videoName = name;
    slot.videoThumb = this.createElementThumbnail(
      video,
      video.videoWidth || 320,
      video.videoHeight || 180
    );

    if (activateImmediately) {
      this.activateSlotMode(target, 'video');
    }
  }

  public async startSlotWebcam(target: 'control' | 'mask'): Promise<boolean> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.addError('Webcam access (getUserMedia) is not supported in this browser.');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      // Wait until the first real frame (with real dimensions) is available,
      // otherwise the preview thumbnail would be captured empty/black
      if (video.readyState < 2 || video.videoWidth === 0) {
        await new Promise<void>((resolve) => {
          const done = () => {
            cleanup();
            resolve();
          };
          const cleanup = () => {
            video.removeEventListener('loadeddata', done);
            video.removeEventListener('playing', done);
          };
          video.addEventListener('loadeddata', done, { once: true });
          video.addEventListener('playing', done, { once: true });
        });
      }

      const slot = target === 'control' ? this.controlMedia : this.maskMedia;
      if (slot.webcamStream) {
        slot.webcamStream.getTracks().forEach((t) => t.stop());
      }
      slot.webcamStream = stream;
      slot.webcamVideo = video;
      this.activateSlotMode(target, 'webcam');
      return true;
    } catch (err) {
      this.addError(
        `Unable to access webcam: ${err instanceof Error ? err.message : 'Permission denied'}.`
      );
      return false;
    }
  }

  /**
   * Switch active source mode ('image' | 'video' | 'webcam') for control or mask
   * without reloading the page (Spec D1).
   * Returns true if the requested mode already has loaded media and was switched immediately.
   */
  public activateSlotMode(
    target: 'control' | 'mask',
    mode: SourceMode
  ): boolean {
    const slot = target === 'control' ? this.controlMedia : this.maskMedia;
    const prevState =
      target === 'control' ? this.state.controlSource : this.state.maskSource;

    if (mode === 'image') {
      if (!slot.imageElement && !slot.imageRaw) {
        return false;
      }
      if (slot.videoElement) slot.videoElement.pause();

      let w = 0;
      let h = 0;
      if (slot.imageElement) {
        w =
          slot.imageElement instanceof HTMLImageElement
            ? slot.imageElement.naturalWidth || slot.imageElement.width
            : slot.imageElement.width;
        h =
          slot.imageElement instanceof HTMLImageElement
            ? slot.imageElement.naturalHeight || slot.imageElement.height
            : slot.imageElement.height;
        if (target === 'control') {
          this.pipeline.uploadControlElement(slot.imageElement, w, h);
        } else {
          this.pipeline.uploadMaskElement(slot.imageElement, w, h);
        }
      } else if (slot.imageRaw) {
        w = slot.imageRaw.width;
        h = slot.imageRaw.height;
        if (target === 'control') {
          this.pipeline.uploadControlRaw(slot.imageRaw);
        } else {
          this.pipeline.uploadMaskRaw(slot.imageRaw);
        }
      }

      const nextSource: MediaSourceState = {
        mode: 'image',
        name: slot.imageName,
        width: w,
        height: h,
        thumbnailUrl: slot.imageThumb,
        playing: false,
        currentTime: 0,
        duration: 0,
      };
      this.applySlotState(target, nextSource);
      return true;
    }

    if (mode === 'video') {
      if (!slot.videoElement) {
        return false;
      }
      const v = slot.videoElement;
      const w = v.videoWidth || 640;
      const h = v.videoHeight || 360;
      v.play().catch(() => {
        // Autoplay may be blocked in some contexts; frame still uploads
      });
      if (target === 'control') {
        this.pipeline.uploadControlElement(v, w, h);
      } else {
        this.pipeline.uploadMaskElement(v, w, h);
      }
      const nextSource: MediaSourceState = {
        mode: 'video',
        name: slot.videoName,
        width: w,
        height: h,
        thumbnailUrl: slot.videoThumb,
        playing: !v.paused,
        currentTime: v.currentTime || 0,
        duration: Number.isFinite(v.duration) ? v.duration : 0,
      };
      this.applySlotState(target, nextSource);
      return true;
    }

    if (mode === 'webcam') {
      if (!slot.webcamVideo) {
        return false;
      }
      if (slot.videoElement) slot.videoElement.pause();
      const v = slot.webcamVideo;
      const w = v.videoWidth || 640;
      const h = v.videoHeight || 480;
      const thumb = this.createElementThumbnail(v, w, h);
      if (target === 'control') {
        this.pipeline.uploadControlElement(v, w, h);
      } else {
        this.pipeline.uploadMaskElement(v, w, h);
      }
      const nextSource: MediaSourceState = {
        mode: 'webcam',
        name: 'Webcam Live',
        width: w,
        height: h,
        thumbnailUrl: thumb,
        playing: true,
        currentTime: 0,
        duration: 0,
      };
      this.applySlotState(target, nextSource);
      return true;
    }

    if (prevState.mode !== 'none' && target === 'mask') {
      this.clearMask();
      return true;
    }
    return false;
  }

  private applySlotState(
    target: 'control' | 'mask',
    nextSource: MediaSourceState
  ): void {
    if (target === 'control') {
      this.state.controlSource = nextSource;
    } else {
      const wasEmpty = !this.state.hasMask;
      this.state.hasMask = nextSource.mode !== 'none';
      if (wasEmpty && this.state.hasMask) {
        this.state.params.maskInfluence = 1; // Spec D11
      }
      this.state.maskSource = nextSource;
    }
    this.renderNow();
    this.ensureLoopState();
    this.emit();
  }

  /**
   * Toggle video play/pause on the video loaded in the given input slot (D14).
   */
  public toggleVideoPlayback(target: 'control' | 'mask'): void {
    const slot = target === 'control' ? this.controlMedia : this.maskMedia;
    const sourceState =
      target === 'control' ? this.state.controlSource : this.state.maskSource;
    if (sourceState.mode !== 'video' || !slot.videoElement) return;
    const activeVideo = slot.videoElement;
    if (activeVideo.paused) {
      activeVideo.play().catch(() => {});
    } else {
      activeVideo.pause();
    }
    this.syncVideoTransportState();
    this.renderNow();
    this.ensureLoopState();
    this.emit();
  }

  public seekVideoNormalized(
    target: 'control' | 'mask',
    progress01: number
  ): void {
    const slot = target === 'control' ? this.controlMedia : this.maskMedia;
    const activeVideo = slot.videoElement;
    if (
      !activeVideo ||
      !Number.isFinite(activeVideo.duration) ||
      activeVideo.duration <= 0
    ) {
      return;
    }
    const clamped = Math.max(0, Math.min(1, progress01));
    activeVideo.currentTime = clamped * activeVideo.duration;
    this.syncVideoTransportState();
    this.uploadDynamicVideoTextures();
    this.renderNow();
    this.emit();
  }

  /**
   * Restart every loaded video from the beginning and resume playback (D15).
   */
  public syncVideosToStart(): void {
    let anyVideo = false;
    for (const slot of [this.controlMedia, this.maskMedia]) {
      if (slot.videoElement) {
        slot.videoElement.currentTime = 0;
        slot.videoElement.play().catch(() => {});
        anyVideo = true;
      }
    }
    if (!anyVideo) return;
    this.syncVideoTransportState();
    this.uploadDynamicVideoTextures();
    this.renderNow();
    this.ensureLoopState();
    this.emit();
  }

  private syncVideoTransportState(): void {
    if (this.state.controlSource.mode === 'video' && this.controlMedia.videoElement) {
      const v = this.controlMedia.videoElement;
      this.state.controlSource.playing = !v.paused && !v.ended;
      this.state.controlSource.currentTime = v.currentTime || 0;
      this.state.controlSource.duration = Number.isFinite(v.duration) ? v.duration : 0;
    }
    if (this.state.maskSource.mode === 'video' && this.maskMedia.videoElement) {
      const v = this.maskMedia.videoElement;
      this.state.maskSource.playing = !v.paused && !v.ended;
      this.state.maskSource.currentTime = v.currentTime || 0;
      this.state.maskSource.duration = Number.isFinite(v.duration) ? v.duration : 0;
    }
  }

  private uploadDynamicVideoTextures(): void {
    if (this.state.controlSource.mode === 'video' && this.controlMedia.videoElement) {
      const v = this.controlMedia.videoElement;
      if (v.readyState >= 2) {
        this.pipeline.uploadControlElement(
          v,
          v.videoWidth || 640,
          v.videoHeight || 360
        );
      }
    } else if (
      this.state.controlSource.mode === 'webcam' &&
      this.controlMedia.webcamVideo
    ) {
      const v = this.controlMedia.webcamVideo;
      if (v.readyState >= 2) {
        this.pipeline.uploadControlElement(
          v,
          v.videoWidth || 640,
          v.videoHeight || 480
        );
      }
    }

    if (this.state.maskSource.mode === 'video' && this.maskMedia.videoElement) {
      const v = this.maskMedia.videoElement;
      if (v.readyState >= 2) {
        this.pipeline.uploadMaskElement(
          v,
          v.videoWidth || 640,
          v.videoHeight || 360
        );
      }
    } else if (
      this.state.maskSource.mode === 'webcam' &&
      this.maskMedia.webcamVideo
    ) {
      const v = this.maskMedia.webcamVideo;
      if (v.readyState >= 2) {
        this.pipeline.uploadMaskElement(
          v,
          v.videoWidth || 640,
          v.videoHeight || 480
        );
      }
    }
  }

  private shouldAnimateLoop(): boolean {
    if (this.clock.isHidden()) return false;
    if (this.state.params.animSpeed !== 0) return true;
    if (
      this.state.controlSource.mode === 'video' &&
      this.controlMedia.videoElement &&
      !this.controlMedia.videoElement.paused
    ) {
      return true;
    }
    if (this.state.controlSource.mode === 'webcam') return true;
    if (
      this.state.maskSource.mode === 'video' &&
      this.maskMedia.videoElement &&
      !this.maskMedia.videoElement.paused
    ) {
      return true;
    }
    if (this.state.maskSource.mode === 'webcam') return true;
    return false;
  }

  private ensureLoopState(): void {
    const needed = this.shouldAnimateLoop();
    if (needed && this.rafId === null) {
      this.clock.reset();
      this.lastFrameRenderMs = performance.now();
      const loop = (now: number) => {
        if (!this.shouldAnimateLoop()) {
          this.rafId = null;
          return;
        }
        const dt = this.clock.tick(now);
        if (this.state.params.animSpeed !== 0 && dt > 0) {
          this.state.params.offset = advanceOffsetLinear(
            this.state.params.offset,
            this.state.params.animSpeed,
            dt
          );
        }
        this.uploadDynamicVideoTextures();
        this.syncVideoTransportState();
        this.renderNow(now);
        this.emit();
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    } else if (!needed && this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Step the animation clock deterministically by `dtSeconds` (for automated tests, §8.2).
   */
  public stepClock(dtSeconds: number): void {
    if (this.clock.isHidden()) return;
    if (this.state.params.animSpeed !== 0 && dtSeconds > 0) {
      this.state.params.offset = advanceOffsetLinear(
        this.state.params.offset,
        this.state.params.animSpeed,
        dtSeconds
      );
    }
    this.uploadDynamicVideoTextures();
    this.renderNow();
    this.emit();
  }

  public setTabHiddenSimulated(hidden: boolean): void {
    this.clock.setHidden(hidden);
    this.ensureLoopState();
  }

  public renderNow(nowMs: number = performance.now()): void {
    const t0 = performance.now();
    this.pipeline.render(this.state.params, this.state.stack.length);
    const renderDuration = performance.now() - t0;

    const elapsedBetweenFrames = Math.max(0.1, nowMs - this.lastFrameRenderMs);
    this.lastFrameRenderMs = nowMs;
    const instantFps = Math.min(240, 1000 / elapsedBetweenFrames);
    this.smoothedFps = this.smoothedFps * 0.8 + instantFps * 0.2;
    this.smoothedFrameMs = this.smoothedFrameMs * 0.8 + renderDuration * 0.2;

    this.state.frameCount += 1;
    this.state.fps = Math.round(this.smoothedFps);
    this.state.frameTimeMs = Number(this.smoothedFrameMs.toFixed(2));
  }

  /**
   * Capture a PNG data URL at the working resolution with guaranteed opaque alpha = 255 (D7, D13).
   */
  public captureSnapshotDataUrl(): string {
    this.renderNow();
    return this.pipeline.canvas.toDataURL('image/png');
  }

  public downloadSnapshotPng(): void {
    const dataUrl = this.captureSnapshotDataUrl();
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `texture-stack-${this.state.workingWidth}x${this.state.workingHeight}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}
