# Image Stack Web App — Base Spec & Plan

Status: draft v0.1 · 2026-10-22
Sources: `image stack` diagram, `texture_stack.glsl`

---

## 1. Purpose

A browser app that runs the **Image Stack Selector** shader live. A grayscale **control map** (video or image) decides, per pixel, which image from a **stack of N images** is visible. An optional **mask** (video or image) decides where the control map itself is shown instead of the stack. Output goes through a (future) FX stage and is rendered to a canvas.

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

### 2.2 What the shader does today

- Input 0 = control map, inputs 1..N = stacked images.
- `control` (0–1) → `scaled = control * (N-1)`.
- **Hard mode** (`uSmoothBlend < 0.5`): pick the nearest layer, `round(scaled)`.
- **Smooth mode**: crossfade layers `floor(scaled)` and `floor(scaled)+1` with `fract(scaled)`.
- Layer index is clamped to `[0, N-1]`.

### 2.3 Gaps between diagram and code (these drive the spec)

| # | Gap | Decision in this spec |
|---|---|---|
| G1 | Shader is TouchDesigner-flavored (`vUV`, `sTD2DInputs[]`, `TDOutputSwizzle`) | Port to WebGL2 / GLSL ES 3.00 (§4.3) |
| G2 | `sTD2DInputs[slot]` is indexed dynamically. GLSL ES 3.00 does **not** allow dynamic indexing of sampler arrays | Use one `sampler2DArray` for the stack (all layers same size) |
| G3 | Mask input and `mask range` are in the diagram but **not in the shader** | Add mask sampler + mask logic (§4.3) |
| G4 | `input offset / contrast / invert` are in the table but **not in the shader** | Add control preprocessing (§4.3) |
| G5 | `uFitSize` is declared but never used | Drop from the shader. Aspect fitting happens at upload time in JS (cover fit) |
| G6 | Shader reads `.r` only (TD feeds a single channel). A web video is RGB | Convert control and mask to luma first |
| G7 | `num images` is `int` in the table, `uNumImages` is `float` in code | UI is int; shader receives `int` |
| G8 | `mask range` is one float, but "which values show the input map" implies a range | Treat as `[min, max]` pair (open question Q2) |
| G9 | `shader FX` has no definition | Reserve a pass slot in the renderer. Pass-through in v1 |

**Status in shader v2:** G3, G4, G5, G6, G7 and G8 are closed in `texture_stack_v2.glsl` and `texture_stack.frag`. G1 and G2 are closed by `texture_stack.frag` (WebGL2). G9 stays open.

---

## 3. Product Spec

### 3.1 Scope

**v1 in scope:** control source (video/image switch), image stack list, mask source (video/image switch), all parameters in 3.3, live preview, PNG snapshot.

**v1 out of scope:** shader FX content (stub only), video export, saving/loading projects, multi-user, mobile layout, audio.

### 3.2 Functional requirements

**Sources**

- **FR-1 Control source.** User selects Video or Image, then loads a file (video: file picker or webcam; image: file picker). Switch changes the active source without reloading the page.
  - *Given* a control video is playing, *when* the user switches to Image, *then* the next rendered frame uses the image as control.
- **FR-2 Mask source.** Same behavior as FR-1, independent from the control source. Mask is optional; with no mask loaded, mask logic is disabled.
- **FR-3 Image stack.** User can add multiple images at once, remove, and reorder them (drag or up/down). Order = layer index (0 = first).
  - Limit: `MAX_LAYERS = 32` in v1. Show a clear message when exceeded.
- **FR-4 Number of images in use.** Default = all loaded images. User can lower it; the shader only uses layers `0..n-1`.

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

- **FR-12** Small preview thumbnails for control and mask so the user can see what each input looks like after offset/contrast/invert.
- **FR-13** Errors (unsupported file, shader compile failure, WebGL2 missing) appear in a visible message area, never only in the console.

### 3.3 Parameters

| Name | Type | Scope | Range | Default | Description |
|---|---|---|---|---|---|
| `numImages` | int | shader | 1..N loaded | N | Images in use |
| `smoothBlend` | bool | shader | 0/1 | 1 | Smooth crossfade vs hard edges |
| `inputOffset` | float | control | 0..1 | 0 | Offset on the control's grayscale values |
| `inputContrast` | float | control | 0..1 | 0.5 (neutral) | Contrast on the control map |
| `inputInvert` | bool | control | 0/1 | 0 | Invert control map |
| `maskRange` | float pair | mask | 0..1 | (0, 0) = off | Mask values inside the range show the control map instead of the stack |

*Ranges and neutral values for offset and contrast are proposals. See Q3.*

### 3.4 Non-functional

- **NFR-1** Targets desktop Chrome and Firefox (WebGL2). Safari best-effort.
- **NFR-2** 30 fps minimum at 1280×720 with 16 layers and two playing videos on a mid-range laptop.
- **NFR-3** Everything runs client-side. No upload of user media anywhere.
- **NFR-4** Shader code lives in its own `.glsl` file, not buried in JS strings.

---

## 4. Technical Plan

### 4.1 Stack (proposal)

- **Vite + TypeScript**
- **Raw WebGL2**, no three.js. The pipeline is 2–3 fullscreen passes, so an engine adds weight without value.
- **Plain DOM UI**. The board links to *terminal.css* and *TuiCss*, so I assume you want a terminal/TUI look. `terminal.css` fits well with plain HTML controls.
- **Vitest** for pure logic (index math, param mapping). Visual checks done manually against reference screenshots.

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

### 4.3 Shader contract (WebGL2 port)

The reference implementation is `texture_stack.frag` (WebGL2). `texture_stack_v2.glsl` is the same logic for TouchDesigner, so the behavior can be tested in TD first.

Uniforms (the contract):

| Uniform | Type | Notes |
|---|---|---|
| `uControl`, `uMask` | `sampler2D` | Converted to luma in the shader |
| `uStack` | `sampler2DArray` | One layer per image, same size |
| `uNumImages` | `int` | 1..MAX_LAYERS |
| `uSmoothBlend` | `float` | 0 = hard, 1 = crossfade |
| `uInputOffset` | `float` | Added after contrast |
| `uInputContrast` | `float` | 0..1, 0.5 neutral, gain = (2c)² |
| `uInputInvert` | `float` | 0 / 1 |
| `uMaskEnabled` | `float` | 0 / 1 |
| `uMaskRange` | `vec2` | (min, max) |

Behavior notes:

- Order of control processing is **invert → contrast → offset**, contrast gain is `(2c)²`. Both are proposals, see Q3.
- Original rule kept: hard mode wants NEAREST filtering on the control texture, smooth mode wants LINEAR. The app sets `TEXTURE_MIN/MAG_FILTER` on the control texture when `smoothBlend` toggles.
- Video textures use `UNPACK_FLIP_Y_WEBGL = true` so image and video share the same orientation.
- Memory: 32 layers at 1280×720 RGBA is about 118 MB; at 1920×1080 about 265 MB. Working resolution is therefore a setting, not fixed.

### 4.4 Render loop

- `requestAnimationFrame` loop. Active videos upload a new frame via `requestVideoFrameCallback` when available, otherwise every tick.
- Static sources (images) are uploaded once, and the loop can idle until a param or source changes.
- Pass 1 renders into an offscreen framebuffer. Pass 2 (FX) reads it and draws to the canvas.

---

## 5. Spec-driven workflow

1. **Spec first.** Any behavior change starts as an edit to `spec.md` (new/changed FR with acceptance criteria), then to `plan.md`, then to `tasks.md`.
2. **Every task cites requirement IDs** (e.g. `T7 → FR-3, FR-4`). No task without a requirement.
3. **Definition of done per task:** acceptance criteria from the cited FR pass, and the change is checked in the running app.
4. **Open questions live in the spec** (section 7) until answered. Answers get folded into the FRs and removed from the list.
5. **Shader is the contract.** Uniform names/types in §4.3 are the source of truth. Changing a uniform means updating the spec in the same commit.

---

## 6. Tasks (v1 milestones)

**M0 — Foundation**
- T0.1 Vite + TS project, lint, `specs/001-image-stack/` with this doc split in three.
- T0.2 WebGL2 context + fullscreen quad + shader compile with visible errors → *FR-13*

**M1 — Shader port, hardcoded inputs**
- T1.1 Port shader per §4.3 with 3 hardcoded images and a procedural gradient as control → *FR-5, FR-7*
- T1.2 Verify hard vs smooth modes match the original TD behavior → *FR-4*

**M2 — Stack**
- T2.1 `TEXTURE_2D_ARRAY` with cover-fit upload at working resolution → *FR-3, FR-6*
- T2.2 Image list UI: add many, remove, reorder → *FR-3*
- T2.3 `numImages` control → *FR-4*

**M3 — Control source**
- T3.1 `SwitchSource` (video | image | webcam) → *FR-1*
- T3.2 Offset / contrast / invert + thumbnail → *FR-9, FR-12*

**M4 — Mask**
- T4.1 Mask `SwitchSource` instance → *FR-2*
- T4.2 Mask range logic + thumbnail → *FR-12*

**M5 — Output**
- T5.1 FX pass-through framebuffer → *FR-7*
- T5.2 PNG snapshot → *FR-8*
- T5.3 Reset-to-default on all controls → *FR-11*

**M6 — Hardening**
- T6.1 Performance pass against NFR-2
- T6.2 Error cases: bad files, no WebGL2, exceeding 32 layers → *FR-13*

---

## 7. Open questions

- **Q1.** Do you want to resample the stack at a fixed working resolution (simple, my proposal), or keep each image at native size and fit in the shader (needs `uFitSize` back, much more complex)?
- **Q2.** `mask range`: single float or a min/max pair? And inside the range, should the output be the *processed* control map (my assumption) or the raw one?
- **Q3.** Ranges for `input offset` (0–1 can only brighten; −1..1 is probably what you want) and the mapping for `input contrast` (what value is neutral?). Is the order invert → contrast → offset right?
- **Q4.** What should **shader FX** contain? A list of effects, or user-written GLSL?
- **Q5.** Is the control source also allowed to be a webcam, and should video files loop?
- **Q6.** Should the mask have a soft edge (smoothstep) around the range, or hard edges only?
- **Q7.** Export: is PNG snapshot enough for v1, or do you need video recording (MediaRecorder) from the start?
