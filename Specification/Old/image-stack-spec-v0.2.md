# Image Stack Web App — Base Spec & Plan

Status: draft **v0.2** · 2026-10-22
Sources: `image stack` diagram, `texture_stack.glsl`
Related files: `texture_stack.frag` (WebGL2, used by the app), `texture_stack_v2.glsl` (TouchDesigner, same logic)

---

## What changed in v0.2

- The shader was rewritten. It now includes the mask, control processing (invert / contrast / offset), luma conversion, `int` image count and a `vec2` mask range. `uFitSize` is gone.
- Gap table (§2.3) now has a **Status** column.
- §4.3 contains the full WebGL2 shader and the uniform contract.
- Contrast and mask behavior are now defined (they were open before). They are still proposals, listed in §7.
- Open questions trimmed to the ones that are still open.

---

## 1. Purpose

A browser app that runs the **Image Stack Selector** shader live. A grayscale **control map** (video or image) decides, per pixel, which image from a **stack of N images** is visible. An optional **mask** (video or image) decides where the control map itself is shown instead of the stack. Output goes through a (future) FX stage and is rendered to a canvas. The output of the shader would be saved as a video file recording the live output of the shader. The web app will be deployed and published via netlify.

---

## 2. Analysis

### 2.1 Pipeline (from the diagram)

| Block | Role |
|---|---|
| video input / image input → **switch input** (green) | Source for the **control image**. Switch picks one. |
| **n images** (blue) | Ordered stack of images → "stack images" input of the shader |
| video input / image input → **switch input** (orange) | Source for the **mask image**. Switch picks one. |
| **UI controls** | Drives shader uniforms |
| **shader** → **shader FX** → **Render** | Main pass → post-FX pass(es) → output |

### 2.2 What the original shader did

- Input 0 = control map, inputs 1..N = stacked images.
- `control` (0–1) → `scaled = control * (N-1)`.
- **Hard mode**: pick the nearest layer, `round(scaled)`.
- **Smooth mode**: crossfade layers `floor(scaled)` and `floor(scaled)+1` with `fract(scaled)`.
- Layer index clamped to `[0, N-1]`.

### 2.3 Gaps between diagram and code

| # | Gap | Decision | Status |
|---|---|---|---|
| G1 | Shader was TouchDesigner-flavored (`vUV`, `sTD2DInputs[]`, `TDOutputSwizzle`) | Port to WebGL2 / GLSL ES 3.00 | **Closed** (`texture_stack.frag`) |
| G2 | Dynamic indexing of `sTD2DInputs[]` is not allowed in GLSL ES 3.00 | One `sampler2DArray` for the stack, all layers same size | **Closed** |
| G3 | Mask input and `mask range` were in the diagram but not in the shader | Mask sampler + range logic added | **Closed** |
| G4 | `input offset / contrast / invert` were in the table but not in the shader | Control processing added (invert → contrast → offset) | **Closed** |
| G5 | `uFitSize` declared but never used | Removed. Aspect fit happens in JS at upload (cover fit) | **Closed** |
| G6 | Shader read `.r` only. A web video is RGB | Control and mask converted to luma | **Closed** |
| G7 | `num images` is `int` in the table, `uNumImages` was `float` | `uNumImages` is now `int` | **Closed** |
| G8 | `mask range` is one float, but "which values show the input map" implies a range | `uMaskRange` is a `vec2` (min, max) | **Closed**, confirm in Q1 |
| G9 | `shader FX` has no definition | Reserve a real pass slot. Pass-through in v1 | **Open** (Q4) |

---

## 3. Product Spec

### 3.1 Scope

**v1 in scope:** control source (video/image switch), image stack list, mask source (video/image switch), all parameters in 3.3, live preview, PNG snapshot.

**v1 out of scope:** shader FX content (stub only), video export, saving/loading projects, multi-user, mobile layout, audio.

### 3.2 Functional requirements

**Sources**

- **FR-1 Control source.** User selects Video or Image, then loads a file (video: file picker or webcam; image: file picker). Switch changes the active source without reloading the page.
  if a video file is given as an input. The video will loop indefinetly.
  - *Given* a control video is playing, *when* the user switches to Image, *then* the next rendered frame uses the image as control.
- **FR-2 Mask source.** Same behavior as FR-1, independent from the control source. Mask is optional. With no mask loaded, `uMaskEnabled = 0`.
- **FR-3 Image stack.** User can add multiple images at once, remove, and reorder them (drag or up/down). Order = layer index (0 = first).
  - Limit: `MAX_LAYERS = 32` in v1. Show a clear message when exceeded.
- **FR-4 Number of images in use.** Default = all loaded images. User can lower it. The shader only uses layers `0..n-1`.

**Rendering**

- **FR-5 Live render.** Canvas updates every frame while any video source is playing, and on any parameter change when all sources are static.
- **FR-6 Working resolution.** A single working resolution (default 1280×720, user-selectable). All stack images are drawn to it with **cover fit** at upload. Control and mask are sampled in normalized UV, so they stretch to the canvas.
- **FR-7 Pipeline stages.** Render order: main shader → FX stage → screen. FX stage is a pass-through in v1 but exists as a real framebuffer pass.
- **FR-8 Snapshot.** Button to download the current canvas as PNG at working resolution.

**Controls** (full table in 3.3)

- **FR-9** All controls update the output in real time.
- **FR-10** Controls are grouped by the block they affect: Shader, Control input, Mask.
- **FR-11** Every control has a reset-to-default.

**Feedback**

- **FR-12** Small preview thumbnails for control and mask, so the user can see each input after offset/contrast/invert.
- **FR-13** Errors (unsupported file, shader compile failure, WebGL2 missing) appear in a visible message area, never only in the console.

### 3.3 Parameters

| UI name | Uniform | Type | Scope | Range | Default | Description |
|---|---|---|---|---|---|---|
| num images | `uNumImages` | int | shader | 1..N loaded | N | Images in use |
| smooth blend | `uSmoothBlend` | float (0/1) | shader | 0/1 | 1 | Smooth crossfade vs hard edges |
| input offset | `uInputOffset` | float | control | -1..1 | 0 | Added to the control's grayscale values after contrast |
| input contrast | `uInputContrast` | float | control | 0..1 | 0.5 (neutral) | Contrast on the control map. Gain = (2c)² |
| input invert | `uInputInvert` | float (0/1) | control | 0/1 | 0 | Invert control map |
| mask enabled | `uMaskEnabled` | float (0/1) | mask | 0/1 | 0 | Automatically 1 when a mask is loaded |
| mask range | `uMaskRange` | vec2 | mask | 0..1 | (0, 0) | Mask values inside the range show the processed control map instead of the stack |

The diagram's table lists offset as 0..1. I widened it to -1..1 so the control can also be darkened. Change it back if you prefer.

### 3.4 Non-functional

- **NFR-1** Targets desktop Chrome and Firefox (WebGL2). Safari best-effort.
- **NFR-2** 30 fps minimum at 1280×720 with 16 layers and two playing videos on a mid-range laptop.
- **NFR-3** Everything runs client-side. No upload of user media anywhere.
- **NFR-4** Shader code lives in its own `.frag` file, not in JS strings.

---

## ~~4. Technical Plan~~

### 4.1 Stack (proposal)

- **Vite + TypeScript**
- **Raw WebGL2**, no three.js. The pipeline is 2–3 fullscreen passes, so an engine adds weight without value.
- **Plain DOM UI**. The board links to *terminal.css* and *TuiCss*, so I assume you want a terminal/TUI look. `terminal.css` fits well with plain HTML controls.
- **Vitest** for pure logic (index math, param mapping). Visual checks done manually.

### 4.2 Module layout

```
src/
  main.ts
  state.ts              // single params + sources store
  gl/
    context.ts          // WebGL2 init, fullscreen quad
    program.ts          // compile/link, error reporting
    stackTexture.ts     // TEXTURE_2D_ARRAY, cover-fit upload, reorder
    videoTexture.ts     // per-frame upload of <video> / <img>
    renderer.ts         // pass 1 shader → pass 2 FX → screen
  shaders/
    fullscreen.vert
    texture_stack.frag
    fx_passthrough.frag
  sources/
    SwitchSource.ts     // video | image abstraction for control and mask
  ui/
    panel.ts            // controls
    stackList.ts        // add / remove / reorder
    thumbnails.ts
specs/
  001-image-stack/
    spec.md  plan.md  tasks.md
```

### 4.3 Shader (WebGL2) — `texture_stack.frag`

```glsl
#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D      uControl;
uniform sampler2D      uMask;
uniform sampler2DArray uStack;

uniform int   uNumImages;      // images in use, 1..MAX_LAYERS
uniform float uSmoothBlend;    // 0.0 = hard switch, 1.0 = crossfade
uniform float uInputOffset;    // added after contrast, accepts negatives
uniform float uInputContrast;  // 0..1, 0.5 = neutral
uniform float uInputInvert;    // 0.0 / 1.0
uniform float uMaskEnabled;    // 0.0 / 1.0
uniform vec2  uMaskRange;      // (min, max), 0..1

float luma(vec3 c)
{
	return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float processControl(float c)
{
	if (uInputInvert > 0.5) c = 1.0 - c;
	float gain = uInputContrast * 2.0;
	gain *= gain;
	c = (c - 0.5) * gain + 0.5;
	return clamp(c + uInputOffset, 0.0, 1.0);
}

void main()
{
	float control = processControl(luma(texture(uControl, vUv).rgb));

	// mask: show the control map instead of the stack
	if (uMaskEnabled > 0.5)
	{
		float m = luma(texture(uMask, vUv).rgb);
		if (m >= uMaskRange.x && m <= uMaskRange.y)
		{
			fragColor = vec4(vec3(control), 1.0);
			return;
		}
	}

	int   last   = max(uNumImages, 1) - 1;
	float scaled = control * float(last);

	if (uSmoothBlend < 0.5)
	{
		// hard switch: nearest layer only
		int idx = clamp(int(floor(scaled + 0.5)), 0, last);
		fragColor = texture(uStack, vec3(vUv, float(idx)));
	}
	else
	{
		// smooth crossfade between the two straddling layers
		int   a = clamp(int(floor(scaled)), 0, last);
		int   b = clamp(a + 1, 0, last);
		float t = fract(scaled);

		fragColor = mix(texture(uStack, vec3(vUv, float(a))),
		                texture(uStack, vec3(vUv, float(b))), t);
	}
}
```

Behavior notes:

- Control processing order is **invert → contrast → offset**. Contrast gain is `(2c)²`: 0 gives flat grey, 0.5 is neutral, 1 gives 4×.
- Inside the mask range, the output is the **processed** control map as grayscale (not the raw one).
- Filtering: the control texture uses NEAREST when `smoothBlend` is 0 and LINEAR when it is 1. The app sets `TEXTURE_MIN/MAG_FILTER` when the toggle changes.
- Video textures use `UNPACK_FLIP_Y_WEBGL = true` so images and videos share the same orientation.
- `luma()` assumes RGB. Browser videos and images are RGB already, so no mono-texture issue on the web.
- Memory: 32 layers at 1280×720 RGBA is about 118 MB, at 1920×1080 about 265 MB. Working resolution is therefore a setting, not fixed.

**TouchDesigner version** (`texture_stack_v2.glsl`) has the same logic. Wiring: input 0 = control, input 1 = mask (connect a Constant TOP and set `uMaskEnabled = 0` when unused), inputs 2..N+1 = stack, `uImageInputOffset = 2`.

### 4.4 Render loop

- `requestAnimationFrame` loop. Active videos upload a new frame via `requestVideoFrameCallback` when available, otherwise every tick.
- Static sources (images) are uploaded once. The loop can idle until a param or source changes.
- Pass 1 renders into an offscreen framebuffer. Pass 2 (FX) reads it and draws to the canvas.

---

## 5. Spec-driven workflow

1. **Spec first.** Any behavior change starts as an edit to `spec.md` (new/changed FR with acceptance criteria), then `plan.md`, then `tasks.md`.
2. **Every task cites requirement IDs** (e.g. `T7 → FR-3, FR-4`). No task without a requirement.
3. **Definition of done per task:** the acceptance criteria from the cited FR pass, and the change is checked in the running app.
4. **Open questions live in the spec** (section 7) until answered. Answers get folded into the FRs and removed from the list.
5. **Shader is the contract.** Uniform names and types in §4.3 are the source of truth. Changing a uniform means updating the spec in the same commit.

---

## 6. Tasks (v1 milestones)

**M0 — Foundation**
- T0.1 Vite + TS project, lint, `specs/001-image-stack/` with this doc split in three.
- T0.2 WebGL2 context + fullscreen quad + shader compile with visible errors → *FR-13*

**M1 — Shader running with hardcoded inputs**
- T1.1 Load `texture_stack.frag` with 3 hardcoded images and a procedural gradient as control → *FR-5, FR-7*
- T1.2 Verify hard vs smooth modes match the original TD behavior → *FR-4*

**M2 — Stack**
- T2.1 `TEXTURE_2D_ARRAY` with cover-fit upload at working resolution → *FR-3, FR-6*
- T2.2 Image list UI: add many, remove, reorder → *FR-3*
- T2.3 `numImages` control → *FR-4*

**M3 — Control source**
- T3.1 `SwitchSource` (video | image | webcam) → *FR-1*
- T3.2 Offset / contrast / invert + thumbnail → *FR-9, FR-12*

**M4 — Mask**
- T4.1 Mask `SwitchSource` instance, auto-set `uMaskEnabled` → *FR-2*
- T4.2 Mask range UI + thumbnail → *FR-12*

**M5 — Output**
- T5.1 FX pass-through framebuffer → *FR-7*
- T5.2 PNG snapshot → *FR-8*
- T5.3 Reset-to-default on all controls → *FR-11*

**M6 — Hardening**
- T6.1 Performance pass against NFR-2
- T6.2 Error cases: bad files, no WebGL2, exceeding 32 layers → *FR-13*

---