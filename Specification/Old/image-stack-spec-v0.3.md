# Image Stack Web App — Base Spec & Plan

Status: draft **v0.3** · 2026-10-22
Sources: `image stack` diagram, `texture_stack.glsl`
Related files: `texture_stack.frag` (WebGL2, used by the app), `texture_stack_v2.glsl` (TouchDesigner, same logic)

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

## 4. Spec-driven workflow

1. **Spec first.** Any behavior change starts as an edit to `spec.md` (new/changed FR with acceptance criteria), then `plan.md`, then `tasks.md`.
2. **Every task cites requirement IDs** (e.g. `T7 → FR-3, FR-4`). No task without a requirement.
3. **Definition of done per task:** the acceptance criteria from the cited FR pass, and the change is checked in the running app.
4. **Shader is the contract.** Uniform names and types are the source of truth. Changing a uniform means updating the spec in the same commit.
