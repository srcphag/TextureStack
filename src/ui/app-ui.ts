import { TextureStackEngine } from '../engine/state';
import {
  AppState,
  DEFAULT_WORKING_HEIGHT,
  DEFAULT_WORKING_WIDTH,
  ShaderParams,
} from '../engine/types';

function formatTimeMMSS(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const totalSec = Math.floor(seconds);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const MEDIA_GLYPH_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
  <rect x="3" y="4" width="18" height="16" />
  <circle cx="8.5" cy="9.5" r="1.5" />
  <path d="M21 15l-5-5L5 20" />
</svg>`;

export function mountTextureStackUI(
  root: HTMLElement,
  canvas: HTMLCanvasElement,
  engine: TextureStackEngine
): void {
  canvas.className = 'ts-render-canvas';
  canvas.setAttribute('data-testid', 'render-canvas');

  root.innerHTML = `
    <!-- ERROR TOAST CONTAINER (Spec D9) -->
    <div class="toast-container" data-testid="error-container"></div>

    <!-- HIDDEN FILE INPUTS -->
    <input type="file" accept="image/*" style="display:none" data-testid="control-image-file-input" />
    <input type="file" accept="video/*,.mov,.mp4,.webm" style="display:none" data-testid="control-video-file-input" />
    <input type="file" accept="image/*" style="display:none" data-testid="mask-image-file-input" />
    <input type="file" accept="video/*,.mov,.mp4,.webm" style="display:none" data-testid="mask-video-file-input" />
    <input type="file" accept="image/*" multiple style="display:none" data-testid="stack-file-input" />

    <!-- LEFT PANEL: INPUTS (Figma 10:479) -->
    <aside class="ts-panel-inputs" data-testid="panel-inputs">
      <div class="ts-section-heading">
        <span class="ts-section-title">Inputs</span>
      </div>

      <!-- CONTROL INPUT (Figma 8:412) -->
      <section class="ts-source-block" data-testid="control-input-group">
        <div class="ts-block-header">
          <span class="ts-field-label">control input</span>
        </div>
        <div class="ts-source-grid">
          <div class="ts-source-buttons">
            <button type="button" class="button" data-testid="control-source-webcam">webcam</button>
            <button type="button" class="button" data-testid="control-source-video">video file</button>
            <button type="button" class="button" data-testid="control-source-image">image file</button>
          </div>
          <div class="ts-source-preview" data-testid="control-thumbnail-box" title="Click to load control image or video">
            <div class="ts-empty-glyph">${MEDIA_GLYPH_SVG}</div>
            <span class="ts-empty-label">add image</span>
          </div>
        </div>
      </section>

      <!-- MASK INPUT (Figma 10:673) -->
      <section class="ts-source-block" data-testid="mask-input-group">
        <div class="ts-block-header">
          <span class="ts-field-label">mask input</span>
          <button type="button" class="ts-reset-inline" data-testid="mask-clear-btn" title="Remove mask">clear</button>
        </div>
        <div class="ts-source-grid">
          <div class="ts-source-buttons">
            <button type="button" class="button" data-testid="mask-source-webcam">webcam</button>
            <button type="button" class="button" data-testid="mask-source-video">video file</button>
            <button type="button" class="button" data-testid="mask-source-image">image file</button>
          </div>
          <div class="ts-source-preview" data-testid="mask-thumbnail-box" title="Click to load mask image or video">
            <div class="ts-empty-glyph">${MEDIA_GLYPH_SVG}</div>
            <span class="ts-empty-label">add image</span>
          </div>
        </div>
      </section>

      <!-- TEXTURE STACK INPUT (Figma 8:413) -->
      <section class="ts-source-block" data-testid="stack-input-group" style="flex:1; min-height:0;">
        <div class="ts-block-header">
          <span class="ts-field-label">texture input</span>
          <span class="ts-field-count" data-testid="stack-count-label">0 files</span>
        </div>
        <div class="ts-header-actions" style="justify-content: space-between;">
          <button type="button" class="button ts-btn-small" data-testid="stack-add-btn">+ add images</button>
          <button type="button" class="button ts-btn-small" data-testid="stack-clear-btn">clear</button>
        </div>
        <div class="ts-stack-container" data-testid="stack-list"></div>
      </section>
    </aside>

    <!-- CENTER PANEL: STAGE + PLAYBACK (Figma 2:106, 5:175, 10:629) -->
    <main class="ts-panel-stage" data-testid="panel-stage">
      <header class="ts-section-heading">
        <div style="display:flex; align-items:baseline; gap:12px;">
          <span class="ts-section-title">TextureStack v0.1</span>
          <span class="ts-section-meta" data-testid="resolution-label">1280 X 720 PX</span>
        </div>
        <div class="ts-header-actions">
          <button type="button" class="button ts-btn-small" data-testid="stats-toggle-btn">stats</button>
          <button type="button" class="button ts-btn-small" data-testid="reset-all-btn">reset all</button>
          <button type="button" class="button is-primary ts-btn-small" data-testid="snapshot-btn">snapshot png</button>
        </div>
      </header>

      <div class="ts-canvas-stage" data-testid="canvas-stage">
        <div class="ts-stats-overlay" data-testid="stats-overlay" style="display:none;"></div>
      </div>

      <footer class="ts-playback" data-testid="playback-actions">
        <div class="ts-transports">
          <!-- CONTROL INPUT TRANSPORT (D14) -->
          <div class="ts-transport" data-testid="control-transport">
            <div class="progress ts-progress-clickable is-static" data-testid="control-progress-bar">
              <div class="progress-bar" data-testid="control-progress-fill" style="width: 0%;"></div>
            </div>
            <div class="ts-transport-row">
              <div class="ts-transport-left">
                <button type="button" class="ts-media-btn" data-testid="control-play-pause-btn" title="Play / Pause control video" disabled>▶</button>
                <span class="ts-field-label" data-testid="control-status-label">Image</span>
              </div>
              <div class="ts-time-display" data-testid="control-time-label" style="display:none;">
                <span class="ts-time-current" data-testid="control-time-current">00:00</span>
                <span class="ts-time-total">/ <span data-testid="control-time-duration">00:00</span></span>
              </div>
              <span class="ts-live-label" data-testid="control-live-label" style="display:none;">Live</span>
            </div>
          </div>

          <!-- MASK INPUT TRANSPORT (D14) -->
          <div class="ts-transport" data-testid="mask-transport">
            <div class="progress ts-progress-clickable is-static" data-testid="mask-progress-bar">
              <div class="progress-bar" data-testid="mask-progress-fill" style="width: 0%;"></div>
            </div>
            <div class="ts-transport-row">
              <div class="ts-transport-left">
                <button type="button" class="ts-media-btn" data-testid="mask-play-pause-btn" title="Play / Pause mask video" disabled>▶</button>
                <span class="ts-field-label" data-testid="mask-status-label">None</span>
              </div>
              <div class="ts-time-display" data-testid="mask-time-label" style="display:none;">
                <span class="ts-time-current" data-testid="mask-time-current">00:00</span>
                <span class="ts-time-total">/ <span data-testid="mask-time-duration">00:00</span></span>
              </div>
              <span class="ts-live-label" data-testid="mask-live-label" style="display:none;">Live</span>
            </div>
          </div>
        </div>
      </footer>
    </main>

    <!-- RIGHT PANEL: PARAMETERS (Figma 10:478) -->
    <aside class="ts-panel-params" data-testid="panel-parameters">
      <div class="ts-section-heading">
        <span class="ts-section-title">Parameters</span>
      </div>

      <!-- WORKING RESOLUTION / CANVAS SIZE (Figma 4:118) -->
      <section class="ts-param-group" data-testid="group-resolution">
        <div class="ts-block-header">
          <span class="ts-field-label">canvas size</span>
          <button type="button" class="ts-reset-inline" data-testid="reset-resolution-btn" title="Reset resolution to 1280×720">rst</button>
        </div>
        <div class="ts-dual-controls">
          <div class="ts-control-split">
            <span class="ts-control-prefix">x</span>
            <input type="number" min="1" max="4096" step="1" class="ts-control-input" data-testid="resolution-width-input" value="1280" />
          </div>
          <div class="ts-control-split">
            <span class="ts-control-prefix">y</span>
            <input type="number" min="1" max="4096" step="1" class="ts-control-input" data-testid="resolution-height-input" value="720" />
          </div>
        </div>
      </section>

      <!-- ANIMATION (Figma 10:470) -->
      <section class="ts-param-group" data-testid="group-animation">
        <div class="ts-block-header">
          <span class="ts-field-label">animation</span>
          <button type="button" class="ts-reset-inline" data-testid="reset-animSpeed-btn" title="Reset speed to 0">rst</button>
        </div>
        <div class="ts-control-box">
          <div class="ts-control-split">
            <span class="ts-control-prefix">speed</span>
            <input type="number" min="-1" max="1" step="0.05" class="ts-control-input" data-testid="param-animSpeed-input" value="0" />
          </div>
          <div class="ts-slider-row">
            <input type="range" min="-1" max="1" step="0.01" class="ts-slider" data-testid="param-animSpeed-slider" value="0" />
          </div>
        </div>
        <div class="ts-toggle-row">
          <button type="button" class="button" data-testid="video-sync-btn" title="Restart all videos from the beginning" disabled>⟲ sync videos</button>
        </div>
      </section>

      <!-- INPUT / CONTROL CONTROLS (Figma 2:86 + Spec §3 Control group) -->
      <section class="ts-param-group" data-testid="group-control">
        <div class="ts-block-header">
          <span class="ts-field-label">input controls</span>
          <button type="button" class="ts-reset-inline" data-testid="reset-group-control-btn" title="Reset input controls">rst all</button>
        </div>

        <!-- contrast -->
        <div class="ts-control-box">
          <div class="ts-control-split">
            <span class="ts-control-prefix">contrast</span>
            <input type="number" min="0" max="4" step="0.05" class="ts-control-input" data-testid="param-contrast-input" value="1" />
          </div>
          <div class="ts-slider-row">
            <input type="range" min="0" max="4" step="0.01" class="ts-slider" data-testid="param-contrast-slider" value="1" />
            <button type="button" class="ts-reset-inline" data-testid="reset-contrast-btn" title="Reset contrast">↺</button>
          </div>
        </div>

        <!-- offset luma -->
        <div class="ts-control-box">
          <div class="ts-control-split">
            <span class="ts-control-prefix">offset luma</span>
            <input type="number" min="0" max="1" step="0.01" class="ts-control-input" data-testid="param-offset-input" value="0" />
          </div>
          <div class="ts-slider-row">
            <input type="range" min="0" max="1" step="0.005" class="ts-slider" data-testid="param-offset-slider" value="0" />
            <button type="button" class="ts-reset-inline" data-testid="reset-offset-btn" title="Reset offset & speed">↺</button>
          </div>
        </div>

        <!-- cyclic toggle -->
        <div class="ts-toggle-row">
          <button type="button" class="button" data-testid="param-cyclic-toggle">cyclic</button>
          <button type="button" class="ts-reset-inline" data-testid="reset-cyclic-btn" title="Reset cyclic">↺</button>
        </div>

        <!-- invert color toggle (from Figma 1:62) -->
        <div class="ts-toggle-row">
          <button type="button" class="button" data-testid="param-invertControl-toggle">invert color</button>
          <button type="button" class="ts-reset-inline" data-testid="reset-invertControl-btn" title="Reset invert color">↺</button>
        </div>
      </section>

      <!-- TEXTURE / SHADER CONTROLS (Figma 8:360 + Spec §3 Shader group) -->
      <section class="ts-param-group" data-testid="group-shader">
        <div class="ts-block-header">
          <span class="ts-field-label">texture controls</span>
          <button type="button" class="ts-reset-inline" data-testid="reset-group-shader-btn" title="Reset texture controls">rst all</button>
        </div>

        <!-- num images -->
        <div class="ts-control-box">
          <div class="ts-control-split">
            <span class="ts-control-prefix">images</span>
            <input type="number" min="1" max="32" step="1" class="ts-control-input" data-testid="param-numImages-input" value="1" />
          </div>
          <div class="ts-slider-row">
            <input type="range" min="1" max="32" step="1" class="ts-slider" data-testid="param-numImages-slider" value="1" />
            <button type="button" class="ts-reset-inline" data-testid="reset-numImages-btn" title="Reset num images to all">↺</button>
          </div>
        </div>

        <!-- smooth blend -->
        <div class="ts-toggle-row">
          <button type="button" class="button is-primary" data-testid="param-smoothBlend-toggle">smooth blend</button>
          <button type="button" class="ts-reset-inline" data-testid="reset-smoothBlend-btn" title="Reset smooth blend">↺</button>
        </div>
      </section>

      <!-- MASK CONTROLS (Figma 8:384 + Spec §3 Mask group) -->
      <section class="ts-param-group" data-testid="group-mask">
        <div class="ts-block-header">
          <span class="ts-field-label">mask control</span>
          <button type="button" class="ts-reset-inline" data-testid="reset-group-mask-btn" title="Reset mask controls">rst all</button>
        </div>

        <!-- mask power / influence -->
        <div class="ts-control-box">
          <div class="ts-control-split">
            <span class="ts-control-prefix">mask power</span>
            <input type="number" min="0" max="1" step="0.05" class="ts-control-input" data-testid="param-maskInfluence-input" value="0" />
          </div>
          <div class="ts-slider-row">
            <input type="range" min="0" max="1" step="0.01" class="ts-slider" data-testid="param-maskInfluence-slider" value="0" />
            <button type="button" class="ts-reset-inline" data-testid="reset-maskInfluence-btn" title="Reset mask influence">↺</button>
          </div>
        </div>

        <!-- mask min & max (Figma 10:458) -->
        <div class="ts-dual-controls">
          <div class="ts-control-box">
            <div class="ts-control-split">
              <span class="ts-control-prefix">min</span>
              <input type="number" min="0" max="1" step="0.05" class="ts-control-input" data-testid="param-maskMin-input" value="0" />
            </div>
            <div class="ts-slider-row">
              <input type="range" min="0" max="1" step="0.01" class="ts-slider" data-testid="param-maskMin-slider" value="0" />
              <button type="button" class="ts-reset-inline" data-testid="reset-maskMin-btn" title="Reset mask min">↺</button>
            </div>
          </div>

          <div class="ts-control-box">
            <div class="ts-control-split">
              <span class="ts-control-prefix">max</span>
              <input type="number" min="0" max="1" step="0.05" class="ts-control-input" data-testid="param-maskMax-input" value="1" />
            </div>
            <div class="ts-slider-row">
              <input type="range" min="0" max="1" step="0.01" class="ts-slider" data-testid="param-maskMax-slider" value="1" />
              <button type="button" class="ts-reset-inline" data-testid="reset-maskMax-btn" title="Reset mask max">↺</button>
            </div>
          </div>
        </div>

        <!-- invert mask -->
        <div class="ts-toggle-row">
          <button type="button" class="button" data-testid="param-invertMask-toggle">invert mask</button>
          <button type="button" class="ts-reset-inline" data-testid="reset-invertMask-btn" title="Reset invert mask">↺</button>
        </div>
      </section>
    </aside>
  `;

  const q = <T extends HTMLElement>(testId: string): T => {
    const el = root.querySelector(`[data-testid="${testId}"]`);
    if (!el) throw new Error(`Missing UI element [data-testid="${testId}"]`);
    return el as T;
  };

  // Mount canvas inside stage
  const canvasStage = q<HTMLDivElement>('canvas-stage');
  canvasStage.appendChild(canvas);

  // File inputs
  const ctrlImgInput = q<HTMLInputElement>('control-image-file-input');
  const ctrlVidInput = q<HTMLInputElement>('control-video-file-input');
  const maskImgInput = q<HTMLInputElement>('mask-image-file-input');
  const maskVidInput = q<HTMLInputElement>('mask-video-file-input');
  const stackFileInput = q<HTMLInputElement>('stack-file-input');

  // Wire Control source buttons (D1: switching does not reload page; if none loaded, opens picker)
  q<HTMLButtonElement>('control-source-image').addEventListener('click', () => {
    if (!engine.activateSlotMode('control', 'image')) {
      ctrlImgInput.click();
    }
  });
  q<HTMLButtonElement>('control-source-video').addEventListener('click', () => {
    if (!engine.activateSlotMode('control', 'video')) {
      ctrlVidInput.click();
    }
  });
  q<HTMLButtonElement>('control-source-webcam').addEventListener('click', () => {
    if (!engine.activateSlotMode('control', 'webcam')) {
      engine.startSlotWebcam('control');
    }
  });
  q<HTMLDivElement>('control-thumbnail-box').addEventListener('click', () => {
    const mode = engine.getState().controlSource.mode;
    if (mode === 'video') {
      ctrlVidInput.click();
    } else {
      ctrlImgInput.click();
    }
  });

  ctrlImgInput.addEventListener('change', async () => {
    if (ctrlImgInput.files?.[0]) {
      await engine.loadSlotFile('control', ctrlImgInput.files[0]);
      ctrlImgInput.value = '';
    }
  });
  ctrlVidInput.addEventListener('change', async () => {
    if (ctrlVidInput.files?.[0]) {
      await engine.loadSlotFile('control', ctrlVidInput.files[0]);
      ctrlVidInput.value = '';
    }
  });

  // Wire Mask source buttons
  q<HTMLButtonElement>('mask-source-image').addEventListener('click', () => {
    if (!engine.activateSlotMode('mask', 'image')) {
      maskImgInput.click();
    }
  });
  q<HTMLButtonElement>('mask-source-video').addEventListener('click', () => {
    if (!engine.activateSlotMode('mask', 'video')) {
      maskVidInput.click();
    }
  });
  q<HTMLButtonElement>('mask-source-webcam').addEventListener('click', () => {
    if (!engine.activateSlotMode('mask', 'webcam')) {
      engine.startSlotWebcam('mask');
    }
  });
  q<HTMLDivElement>('mask-thumbnail-box').addEventListener('click', () => {
    const mode = engine.getState().maskSource.mode;
    if (mode === 'video') {
      maskVidInput.click();
    } else {
      maskImgInput.click();
    }
  });
  q<HTMLButtonElement>('mask-clear-btn').addEventListener('click', () => {
    engine.clearMask();
  });

  maskImgInput.addEventListener('change', async () => {
    if (maskImgInput.files?.[0]) {
      await engine.loadSlotFile('mask', maskImgInput.files[0]);
      maskImgInput.value = '';
    }
  });
  maskVidInput.addEventListener('change', async () => {
    if (maskVidInput.files?.[0]) {
      await engine.loadSlotFile('mask', maskVidInput.files[0]);
      maskVidInput.value = '';
    }
  });

  // Wire Stack buttons
  q<HTMLButtonElement>('stack-add-btn').addEventListener('click', () => {
    stackFileInput.click();
  });
  q<HTMLButtonElement>('stack-clear-btn').addEventListener('click', () => {
    engine.clearStack();
  });
  stackFileInput.addEventListener('change', async () => {
    if (stackFileInput.files && stackFileInput.files.length > 0) {
      await engine.addStackFiles(stackFileInput.files);
      stackFileInput.value = '';
    }
  });

  // Wire Stage Header & Transport
  q<HTMLButtonElement>('snapshot-btn').addEventListener('click', () => {
    engine.downloadSnapshotPng();
  });
  q<HTMLButtonElement>('stats-toggle-btn').addEventListener('click', () => {
    engine.toggleStats();
  });
  q<HTMLButtonElement>('reset-all-btn').addEventListener('click', () => {
    engine.resetGroup('all');
  });
  q<HTMLButtonElement>('control-play-pause-btn').addEventListener('click', () => {
    engine.toggleVideoPlayback('control');
  });
  q<HTMLButtonElement>('mask-play-pause-btn').addEventListener('click', () => {
    engine.toggleVideoPlayback('mask');
  });
  q<HTMLButtonElement>('video-sync-btn').addEventListener('click', () => {
    engine.syncVideosToStart();
  });
  q<HTMLDivElement>('control-progress-bar').addEventListener('click', (e) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width > 0) {
      const p = (e.clientX - rect.left) / rect.width;
      engine.seekVideoNormalized('control', p);
    }
  });
  q<HTMLDivElement>('mask-progress-bar').addEventListener('click', (e) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect.width > 0) {
      const p = (e.clientX - rect.left) / rect.width;
      engine.seekVideoNormalized('mask', p);
    }
  });

  // Wire Working Resolution
  const resWInput = q<HTMLInputElement>('resolution-width-input');
  const resHInput = q<HTMLInputElement>('resolution-height-input');
  const applyResolutionChange = () => {
    const w = parseInt(resWInput.value, 10);
    const h = parseInt(resHInput.value, 10);
    engine.setWorkingResolution(w, h);
  };
  resWInput.addEventListener('change', applyResolutionChange);
  resHInput.addEventListener('change', applyResolutionChange);
  q<HTMLButtonElement>('reset-resolution-btn').addEventListener('click', () => {
    engine.setWorkingResolution(DEFAULT_WORKING_WIDTH, DEFAULT_WORKING_HEIGHT);
  });

  // Wire Slider + Numeric Input parameters
  const bindContinuousParam = (key: keyof ShaderParams) => {
    const numEl = q<HTMLInputElement>(`param-${key}-input`);
    const sliderEl = q<HTMLInputElement>(`param-${key}-slider`);
    const resetBtn = q<HTMLButtonElement>(`reset-${key}-btn`);

    sliderEl.addEventListener('input', () => {
      engine.setParam(key, parseFloat(sliderEl.value));
    });
    numEl.addEventListener('input', () => {
      const v = parseFloat(numEl.value);
      if (!Number.isNaN(v)) {
        engine.setParam(key, v);
      }
    });
    resetBtn.addEventListener('click', () => {
      engine.resetParam(key);
    });
  };

  bindContinuousParam('animSpeed');
  bindContinuousParam('contrast');
  bindContinuousParam('offset');
  bindContinuousParam('numImages');
  bindContinuousParam('maskInfluence');
  bindContinuousParam('maskMin');
  bindContinuousParam('maskMax');

  // Wire Boolean Toggle parameters
  const bindToggleParam = (key: keyof ShaderParams) => {
    const btn = q<HTMLButtonElement>(`param-${key}-toggle`);
    const rst = q<HTMLButtonElement>(`reset-${key}-btn`);
    btn.addEventListener('click', () => {
      const cur = engine.getState().params[key];
      engine.setParam(key, cur >= 0.5 ? 0 : 1);
    });
    rst.addEventListener('click', () => {
      engine.resetParam(key);
    });
  };

  bindToggleParam('cyclic');
  bindToggleParam('invertControl');
  bindToggleParam('smoothBlend');
  bindToggleParam('invertMask');

  // Wire Group Reset buttons
  q<HTMLButtonElement>('reset-group-control-btn').addEventListener('click', () => {
    engine.resetGroup('control');
  });
  q<HTMLButtonElement>('reset-group-shader-btn').addEventListener('click', () => {
    engine.resetGroup('shader');
  });
  q<HTMLButtonElement>('reset-group-mask-btn').addEventListener('click', () => {
    engine.resetGroup('mask');
  });

  // Track previous signatures to avoid unnecessary DOM rebuilds on every animation frame
  let lastStackSignature = '';
  let lastControlThumbSig = '';
  let lastMaskThumbSig = '';
  let lastErrorsSig = '';
  let dragSourceIndex: number | null = null;

  const syncControlOrMaskPreview = (
    box: HTMLDivElement,
    source: AppState['controlSource'],
    thumbTestId: string,
    defaultEmptyLabel: string
  ) => {
    if (source.mode === 'none' || !source.thumbnailUrl) {
      box.classList.remove('is-loaded');
      box.innerHTML = `
        <div class="ts-empty-glyph">${MEDIA_GLYPH_SVG}</div>
        <span class="ts-empty-label">${defaultEmptyLabel}</span>
      `;
    } else {
      box.classList.add('is-loaded');
      box.innerHTML = `
        <img src="${source.thumbnailUrl}" alt="${source.name}" data-testid="${thumbTestId}" />
        <span class="ts-preview-badge">${source.name}</span>
      `;
    }
  };

  const updateUI = (state: AppState) => {
    // 1. Resolution
    q<HTMLSpanElement>('resolution-label').textContent =
      `${state.workingWidth} X ${state.workingHeight} PX`;
    if (document.activeElement !== resWInput) {
      resWInput.value = String(state.workingWidth);
    }
    if (document.activeElement !== resHInput) {
      resHInput.value = String(state.workingHeight);
    }

    // 2. Control & Mask source button active states & thumbnails
    const setActiveBtn = (testId: string, active: boolean) => {
      q<HTMLButtonElement>(testId).classList.toggle('is-primary', active);
    };
    setActiveBtn('control-source-webcam', state.controlSource.mode === 'webcam');
    setActiveBtn('control-source-video', state.controlSource.mode === 'video');
    setActiveBtn('control-source-image', state.controlSource.mode === 'image');

    setActiveBtn('mask-source-webcam', state.maskSource.mode === 'webcam');
    setActiveBtn('mask-source-video', state.maskSource.mode === 'video');
    setActiveBtn('mask-source-image', state.maskSource.mode === 'image');

    const ctrlSig = `${state.controlSource.mode}:${state.controlSource.name}:${state.controlSource.thumbnailUrl.length}`;
    if (ctrlSig !== lastControlThumbSig) {
      lastControlThumbSig = ctrlSig;
      syncControlOrMaskPreview(
        q<HTMLDivElement>('control-thumbnail-box'),
        state.controlSource,
        'control-thumbnail',
        'add image'
      );
    }

    const maskSig = `${state.maskSource.mode}:${state.maskSource.name}:${state.maskSource.thumbnailUrl.length}`;
    if (maskSig !== lastMaskThumbSig) {
      lastMaskThumbSig = maskSig;
      syncControlOrMaskPreview(
        q<HTMLDivElement>('mask-thumbnail-box'),
        state.maskSource,
        'mask-thumbnail',
        'add image'
      );
    }

    // 3. Stack list & count
    q<HTMLSpanElement>('stack-count-label').textContent =
      `${state.stack.length} ${state.stack.length === 1 ? 'file' : 'files'}`;

    const stackSig =
      state.stack.map((s) => `${s.id}:${s.name}`).join('|') +
      `#n=${state.params.numImages}`;
    if (stackSig !== lastStackSignature) {
      lastStackSignature = stackSig;
      const stackContainer = q<HTMLDivElement>('stack-list');
      stackContainer.classList.toggle('is-loaded', state.stack.length > 0);

      if (state.stack.length === 0) {
        stackContainer.innerHTML = `
          <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:24px 0; text-align:center;">
            <div class="ts-empty-glyph">${MEDIA_GLYPH_SVG}</div>
            <span class="ts-empty-label" data-testid="stack-empty-state">no stack images loaded</span>
          </div>
        `;
      } else {
        const grid = document.createElement('div');
        grid.className = 'ts-stack-grid';

        state.stack.forEach((item, index) => {
          const isActiveLayer = index < state.params.numImages;
          const card = document.createElement('div');
          card.className = `ts-stack-item ${
            isActiveLayer ? 'is-active-layer' : 'is-inactive-layer'
          }`;
          card.draggable = true;
          card.setAttribute('data-testid', `stack-item-${index}`);
          card.setAttribute('data-layer-name', item.name);
          card.title = `#${index + 1} ${item.name}`;

          card.innerHTML = `
            <img src="${item.thumbnailUrl}" alt="${item.name}" />
            <span class="ts-stack-index">#${index + 1}</span>
            <div class="ts-stack-actions">
              <button type="button" class="ts-stack-mini-btn" data-testid="stack-move-up-${index}" title="Move earlier" ${
                index === 0 ? 'disabled' : ''
              }>◀</button>
              <button type="button" class="ts-stack-mini-btn" data-testid="stack-move-down-${index}" title="Move later" ${
                index === state.stack.length - 1 ? 'disabled' : ''
              }>▶</button>
              <button type="button" class="ts-stack-mini-btn is-remove" data-testid="stack-remove-${index}" title="Remove image">✕</button>
            </div>
          `;

          card.addEventListener('dragstart', (e) => {
            dragSourceIndex = index;
            if (e.dataTransfer) {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(index));
            }
          });
          card.addEventListener('dragover', (e) => {
            e.preventDefault();
            card.classList.add('is-drag-over');
          });
          card.addEventListener('dragleave', () => {
            card.classList.remove('is-drag-over');
          });
          card.addEventListener('drop', (e) => {
            e.preventDefault();
            card.classList.remove('is-drag-over');
            const from =
              dragSourceIndex ??
              parseInt(e.dataTransfer?.getData('text/plain') || '-1', 10);
            dragSourceIndex = null;
            if (from >= 0 && from !== index) {
              engine.reorderStackLayer(from, index);
            }
          });

          card
            .querySelector(`[data-testid="stack-move-up-${index}"]`)
            ?.addEventListener('click', (e) => {
              e.stopPropagation();
              engine.reorderStackLayer(index, index - 1);
            });
          card
            .querySelector(`[data-testid="stack-move-down-${index}"]`)
            ?.addEventListener('click', (e) => {
              e.stopPropagation();
              engine.reorderStackLayer(index, index + 1);
            });
          card
            .querySelector(`[data-testid="stack-remove-${index}"]`)
            ?.addEventListener('click', (e) => {
              e.stopPropagation();
              engine.removeStackLayer(index);
            });

          grid.appendChild(card);
        });

        stackContainer.innerHTML = '';
        stackContainer.appendChild(grid);
      }
    }

    // 4. Sync Parameter Values
    const syncSliderAndInput = (
      key: keyof ShaderParams,
      decimals: number,
      maxOverride?: number
    ) => {
      const val = state.params[key];
      const numEl = q<HTMLInputElement>(`param-${key}-input`);
      const sliderEl = q<HTMLInputElement>(`param-${key}-slider`);
      if (maxOverride !== undefined) {
        numEl.max = String(maxOverride);
        sliderEl.max = String(maxOverride);
      }
      const formatted =
        decimals === 0 ? String(Math.round(val)) : Number(val.toFixed(decimals)).toString();
      if (document.activeElement !== numEl) {
        numEl.value = formatted;
      }
      if (document.activeElement !== sliderEl) {
        sliderEl.value = String(val);
      }
    };

    const maxLoaded = Math.max(1, state.stack.length);
    syncSliderAndInput('animSpeed', 2);
    syncSliderAndInput('contrast', 2);
    syncSliderAndInput('offset', 3);
    syncSliderAndInput('numImages', 0, maxLoaded);
    syncSliderAndInput('maskInfluence', 2);
    syncSliderAndInput('maskMin', 2);
    syncSliderAndInput('maskMax', 2);

    setActiveBtn('param-cyclic-toggle', state.params.cyclic >= 0.5);
    setActiveBtn('param-invertControl-toggle', state.params.invertControl >= 0.5);
    setActiveBtn('param-smoothBlend-toggle', state.params.smoothBlend >= 0.5);
    setActiveBtn('param-invertMask-toggle', state.params.invertMask >= 0.5);

    // 5. Mask Controls Disabled State (Spec D11)
    const maskGroup = q<HTMLElement>('group-mask');
    const maskDisabled = !state.hasMask;
    maskGroup.classList.toggle('is-disabled', maskDisabled);
    const maskInteractiveIds = [
      'param-maskInfluence-input',
      'param-maskInfluence-slider',
      'reset-maskInfluence-btn',
      'param-maskMin-input',
      'param-maskMin-slider',
      'reset-maskMin-btn',
      'param-maskMax-input',
      'param-maskMax-slider',
      'reset-maskMax-btn',
      'param-invertMask-toggle',
      'reset-invertMask-btn',
      'reset-group-mask-btn',
    ];
    for (const id of maskInteractiveIds) {
      (q<HTMLInputElement | HTMLButtonElement>(id)).disabled = maskDisabled;
    }

    // 6. Playback transports — one per input media (D14, Figma "Progress Bar" frame)
    const renderTransport = (
      prefix: 'control' | 'mask',
      source: AppState['controlSource']
    ) => {
      const bar = q<HTMLDivElement>(`${prefix}-progress-bar`);
      const fill = q<HTMLDivElement>(`${prefix}-progress-fill`);
      const btn = q<HTMLButtonElement>(`${prefix}-play-pause-btn`);
      const statusLabel = q<HTMLSpanElement>(`${prefix}-status-label`);
      const timeLabel = q<HTMLDivElement>(`${prefix}-time-label`);
      const timeCur = q<HTMLSpanElement>(`${prefix}-time-current`);
      const timeDur = q<HTMLSpanElement>(`${prefix}-time-duration`);
      const liveLabel = q<HTMLSpanElement>(`${prefix}-live-label`);

      bar.classList.remove('is-static', 'is-live');
      fill.style.width = '0%';

      if (source.mode === 'video') {
        statusLabel.textContent = prefix === 'control' ? 'Video Input' : 'Video Mask';
        btn.disabled = false;
        btn.textContent = source.playing ? '❚❚' : '▶';
        timeLabel.style.display = 'flex';
        liveLabel.style.display = 'none';
        timeCur.textContent = formatTimeMMSS(source.currentTime);
        timeDur.textContent = formatTimeMMSS(source.duration);
        const pct =
          source.duration > 0
            ? Math.min(100, (source.currentTime / source.duration) * 100)
            : 0;
        fill.style.width = `${pct.toFixed(1)}%`;
      } else if (source.mode === 'webcam') {
        bar.classList.add('is-live');
        statusLabel.textContent = 'Webcam';
        btn.disabled = true;
        btn.textContent = '▶';
        timeLabel.style.display = 'none';
        liveLabel.style.display = 'inline';
      } else {
        bar.classList.add('is-static');
        statusLabel.textContent = source.mode === 'image' ? 'Image' : 'None';
        btn.disabled = true;
        btn.textContent = '▶';
        timeLabel.style.display = 'none';
        liveLabel.style.display = 'none';
      }
    };

    renderTransport('control', state.controlSource);
    renderTransport('mask', state.maskSource);

    // Sync button enabled when any video is loaded (D15)
    q<HTMLButtonElement>('video-sync-btn').disabled = !(
      state.controlSource.mode === 'video' || state.maskSource.mode === 'video'
    );

    // 7. Stats Overlay (§8.2)
    const statsEl = q<HTMLDivElement>('stats-overlay');
    statsEl.style.display = state.statsVisible ? 'block' : 'none';
    if (state.statsVisible) {
      statsEl.innerHTML = `
        <div><strong>FPS:</strong> ${state.fps}</div>
        <div><strong>FRAME:</strong> ${state.frameTimeMs} ms</div>
        <div><strong>LAYERS:</strong> ${state.params.numImages} / ${state.stack.length}</div>
        <div><strong>RES:</strong> ${state.workingWidth}×${state.workingHeight}</div>
      `;
    }

    // 8. Error Toasts (Spec D9)
    const errSig = state.errors.map((e) => e.id).join('|');
    if (errSig !== lastErrorsSig) {
      lastErrorsSig = errSig;
      const errContainer = q<HTMLDivElement>('error-container');
      errContainer.innerHTML = '';
      for (const err of state.errors) {
        const toast = document.createElement('div');
        toast.className = 'toast is-danger';
        toast.setAttribute('data-testid', 'error-toast');
        toast.innerHTML = `
          <div style="flex:1;">
            <div class="toast-title">Error</div>
            <div class="toast-message" data-testid="error-message">${err.message}</div>
          </div>
          <button type="button" class="toast-close" data-testid="error-dismiss-btn" title="Dismiss">✕</button>
        `;
        toast
          .querySelector('[data-testid="error-dismiss-btn"]')
          ?.addEventListener('click', () => {
            engine.dismissError(err.id);
          });
        errContainer.appendChild(toast);
      }
    }
  };

  engine.subscribe(updateUI);
}
