# Texture Stack — Technical Decisions

Status: v0.7 · 2026-10-24
Replaces v0.6. The tech stack and architecture are **not decided here**: the agent decides them and records each choice in §6. The UI is defined by a Figma file and a premade CSS library (§7).

Reference files:
- `texture_stack3.glsl` — TouchDesigner shader. **Source of truth** for the shader behavior.
- `texture_stack3_web.frag` — WebGL2 port of it. Reference implementation for the app.
- `Schem.jpg` — schematic of the app architecture.
- `TestVideo1.mov`  — video input for testing
- `Images\Dataset\nImages.jpg`  — 25 Images input for testing
- [[Figma UI Prototype]]  — WIP UI reference.
- [[CSS Library]] — CSS Library to work with.

![[Schem.jpg]]

The schematic shows the pipeline. Where its parameter list differs from this document, **this document wins**.

---

## What changed in v0.7

- **The offset animation is now one linear animation with one speed parameter.** Removed: the animate toggle, loop / ping-pong mode and reverse. Speed 0 means no animation.
- Tests, Figma handoff and open questions updated to match. Q2 from v0.6 is closed.
- The shaders do not change (`texture_stack3.glsl`, `texture_stack3_web.frag`).

---

## 1. Goal

A web interface that runs the Texture Stack GLSL shader live. A **control map** (video or image) picks, per pixel, which image of a **stack** is visible, using its luminance. An optional **mask** (video or image) mixes the original control image back in. The result goes through an FX stage (empty in v1) and is drawn on a canvas. The web app is deployed and published on Netlify.

It is an artistic tool. The agent proves it works. The user judges how it looks and feels.

## 2. Decision status

| Area | Status |
|---|---|
| Behavior, inputs, controls (§3) | Decided |
| Shader logic and uniforms (§4) | Decided |
| Constraints (§5) | Decided |
| Tech stack, architecture, libraries, project structure, build, test tooling (§6) | **Delegated to the agent** |
| UI: Figma and CSS library (§7) | Decided by the user |
| Testing split and done rule (§8) | Decided |
| Open questions (§10) | Waiting for the user |

---

## 3. Behavior

Pipeline: **control source** (switch video/image) + **stack** (n images) + **mask source** (switch video/image, optional) + **UI controls** → shader → FX stage → render canvas.

| # | Decision |
|---|---|
| D1 | Control and mask each have their own video/image switch. Switching does not reload the page. |
| D2 | The stack is an ordered list of images: add many, remove, reorder. Order = layer index. Maximum 32. |
| D3 | `num images` defaults to all loaded images and can be lowered. The shader only uses the first n. |
| D4 | One **working resolution** for the whole stack (default 1280×720, selectable). Stack images are cover-fitted to it when loaded. Control and mask are sampled in normalized UV, so they stretch to the canvas. |
| D5 | The FX stage exists as a real pass, and is pass-through in v1. |
| D6 | Live render: updates every frame while any video plays or the animation speed is not 0, otherwise only when something changes. |
| D7 | PNG snapshot at working resolution. |
| D8 | All controls update in real time, are grouped (Shader / Control / Mask), and each has reset-to-default. Small thumbnails show the control and the mask. |
| D9 | Errors (unsupported file, shader failure, no GPU support, too many images) are visible in the UI, never only in the console. |
| D10 | The look of the UI is defined by the Figma file (§7). |
| D11 | With no mask loaded, the mask controls are disabled and the app sets `uMaskInfluence = 0`. When a mask is loaded, influence defaults to 1. |
| D12 | The offset can be animated in v1: one linear animation with a single speed control (see "Offset animation" below). |
| D13 | The output is always opaque. Images with transparency are flattened over black when loaded, and the shader outputs alpha 1. The PNG snapshot has no transparency. |
| D14 | The playback bar has one transport per input: control (left) and mask (right). Video shows play/pause, cyan progress and `MM:SS / MM:MM`. Webcam shows a red track and `Live`. Image or empty input shows a static grey track with no time. See the Figma "Progress Bar" frame. |
| D15 | A **sync** button (in the Parameters column, animation group) restarts all loaded videos from the beginning. A newly loaded video always starts at time 0. |

### Parameters

| UI name | Uniform | Type | Range | Default | Description |
|---|---|---|---|---|---|
| num images | `uNumImages` | int | 1..loaded | all | Images in use |
| smooth blend | `uSmoothBlend` | float 0/1 | 0/1 | 1 | Crossfade vs hard switch |
| cyclic | `uCyclic` | float 0/1 | 0/1 | 0 | Offset wraps and loops (1) or clamps (0) |
| contrast | `uContrast` | float | 0..4 | 1 | 1 = unchanged, above 1 more contrast, below 1 flatter, 0 = flat grey |
| offset | `uOffset` | float | 0..1 | 0 | Added to the control luminance. Driven by the animation speed when it is not 0 |
| mask influence | `uMaskInfluence` | float | 0..1 | 1 (0 with no mask) | 0 = mask ignored, 1 = fully applied |
| invert mask | `uInvertMask` | float 0/1 | 0/1 | 0 | Flip the mask |
| mask min | `uMaskMin` | float | 0..1 | 0 | Mask values at or below this become 0 |
| mask max | `uMaskMax` | float | 0..1 | 1 | Mask values at or above this become 1 |

Ranges and defaults that `texture_stack3.glsl` does not state (the contrast maximum, smooth blend and cyclic defaults) are proposals. See §10.

### Offset animation

The app moves `uOffset` over time in a straight line. This is an app-level control, not a shader uniform, and the shader does not change.

| UI name | Name | Type | Range | Default | Description |
|---|---|---|---|---|---|
| speed | `animSpeed` | float | -1..1 | 0 | Full 0→1 sweeps per second. 0 = no animation, 0.1 = one sweep every 10 seconds, negative runs backwards |

Behavior:

- The offset increases at a constant rate and wraps from 1 back to 0 (and from 0 to 1 when going backwards). There are no modes and no easing.
- With cyclic on, the wrap is seamless. With cyclic off, the output jumps when the offset wraps.
- The offset slider always shows the current value, so it moves while animating. Dragging it sets the current position and the animation continues from there.
- Setting speed to 0 freezes the offset at its current value.
- Time comes from real elapsed time, so the speed is the same at any frame rate. When the tab is hidden the animation pauses, with no jump when it returns.
- Reset-to-default sets the offset to 0 and the speed to 0.

---

## 4. Shader contract

The behavior below is fixed and matches `texture_stack3.glsl`. Whatever API the agent chooses, the output must match `texture_stack3_web.frag`.

**Algorithm, per pixel**

1. `control` = RGB of the control pixel. `n = max(num images, 1)`.
2. Contrast, per channel: `c = clamp((control − 0.5) · contrast + 0.5, 0, 1)`. Then `lum = dot(c, (0.2126, 0.7152, 0.0722))`.
3. Stacked result:
   - **Cyclic off:** `scaled = clamp(lum + offset, 0, 1) · (n − 1)`.
     - *Hard:* layer = `clamp(floor(scaled + 0.5), 0, n−1)`.
     - *Smooth:* `a = clamp(floor(scaled), 0, n−1)`, `b = clamp(a + 1, 0, n−1)`, result = `mix(layer a, layer b, fract(scaled))`.
   - **Cyclic on:** `scaled = fract(lum + offset) · n`.
     - *Hard:* layer = `floor(scaled) mod n`.
     - *Smooth:* `a = floor(scaled) mod n`, `b = (a + 1) mod n`, result = `mix(layer a, layer b, fract(scaled))`. The last layer blends back into the first.
4. Mask: `m_raw` = **luminance** of the mask pixel (same weights as step 2). Remap with `lo = min(maskMin, maskMax)` and `hi = max(maskMin, maskMax)`: `mask = clamp((m_raw − lo) / max(hi − lo, 1e-5), 0, 1)`. If invert is on, `mask = 1 − mask`. Then `m = mix(1, mask, clamp(influence, 0, 1))`.
5. `original` = `(control.rgb, 1)`. This is the raw control image, **without** contrast or offset.
6. Output RGB = `mix(original.rgb, stacked.rgb, m)` and **alpha = 1**. Mask white shows the stack, mask black shows the original control image.

**Rules**

- With `n = 1` the stacked result is always layer 0.
- Images and videos must share the same orientation (no flipped sources).
- No transparency: images with transparency are flattened over black when loaded, and the output alpha is always 1 (D13).
- Texture filtering on the control and mask is an implementation choice. It must not change the results of the pixel tests (§8.2).
- If the chosen API cannot index a list of textures dynamically (WebGL2 cannot), the agent stores the stack as one layered texture. This is why the stack shares one working resolution (D4).

---

## 5. Constraints

- Runs fully in the browser. No media is uploaded anywhere.
- Starts as a local app.
- After the local development, the app will be Deployed as a **static site on Netlify**. No server code. The production build must work exactly as Netlify serves it.
- Desktop Chrome and Firefox. Safari best effort.
- Target 30 fps or more at 1280×720 with 16 layers and two playing videos on a mid-range laptop.
- 32 layers at 1280×720 must allocate with no errors (about 118 MB). Memory grows with the working resolution.
- Shader code lives in its own file, not inside code strings.

---

## 6. Delegated to the agent

The agent decides: language, graphics API, build tool, project structure, dependencies, test tooling, the Netlify configuration. The UI approach is **not** delegated (§7).

**Rules for deciding**

1. Decide before building, and record it in the log below: the choice, the reason, and the alternatives considered.
2. Satisfy §3 to §5. Do not change the behavior to fit a tool. If a tool forces a change, tell the user.
3. Prefer few dependencies, mainstream and maintained tools, and a setup one person can run with three commands: install, run, review.
4. Do not lock the shader contract (§4) into a framework. The shader logic must stay portable.
5. Only ask the user about decisions that change what they see or do (look, behavior, supported browsers, cost). Everything else is logged.

**Decision log** (the agent fills in the empty rows)

| Decision | Choice | Why | Alternatives considered |
|---|---|---|---|
| Language | TypeScript (ES2022, strict) | Compile-time safety for shader uniforms, state store, and swappable UI contract (§7 Rule 3) with zero runtime overhead. | Plain JavaScript (weaker contract between engine and UI), Rust/WASM (unnecessary build complexity for WebGL2 + DOM). |
| Graphics API | Raw WebGL2 | Directly executes `texture_stack3_web.frag` (`#version 300 es`) with `sampler2DArray` (`texImage3D`/`texSubImage3D`) for the 32-layer stack and an FBO pass for the FX stage (D5), with zero framework lock-in (§6 Rule 4). | Three.js / Babylon.js (heavyweight, obscures raw 2D array texture & FBO pipeline), WebGPU (less mature across Firefox/Safari, requires WGSL port). |
| Build tool | Vite | Fast dev server, native `.frag`/`.vert` raw file imports (`?raw`, keeping shader code in standalone files per §5), clean static `dist/` build with relative base (`base: './'`) for root or subfolder serving (§8.2). | Webpack / Parcel (slower, heavier config), unbundled ESM (harder to manage TypeScript + static asset bundling). |
| Project structure | `src/engine/`, `src/shaders/`, `src/ui/`, `tests/`, `public/demo/` | Strictly separates portable WebGL2/state/clock engine from the swappable `terminal.css`/Figma UI (§7 Rule 3), with standalone GLSL files (§5) and automated test suites (§8). | Monolithic single-folder `src/` (couples UI to WebGL logic). |
| Test tooling | Vitest (unit / CPU reference) + Playwright (headless Chromium WebGL2 + E2E) | Vitest verifies the §4 CPU reference shader and deterministic clock/state math; Playwright runs real WebGL2 pixel readbacks against the CPU reference, E2E UI & animation tests, and static HTTP serving checks (root + subfolder). | Jest + Puppeteer (more boilerplate), Cypress (heavier, less suited for subfolder static server checks). |
| Netlify configuration | `netlify.toml` (`publish = "dist"`, `command = "npm run build"`) | Zero-server static deployment matching local preview. | Manual drag-and-drop only (harder to reproduce). |
| Hosting | Netlify (static) | Decided by the user | — |
| CSS library | `letieu/terminal.css` v0.0.4 (vendored locally + Figma CSS variables) | Decided by the user (`UI/CSS Library.md`). Vendored locally for offline reliability and styled with Figma tokens. | CDN-only link (breaks offline testing). |

Feedback decisions from the review (§8.3) go in a separate file, `decisions.md`.

---

## 7. UI: Figma and CSS library

**Source of truth:** the Figma file work as reference. The Library work as the main reference for classes.

**Rules**

1. The Figma wins visually. The library provides the base components. Custom CSS only where the library lacks something, and each case is logged.
2. Figma variables (colors, spacing, type) become CSS custom properties. Layer names in the Figma become component names in the code.
3. **The UI must be swappable.** Logic and state live apart from presentation. The UI only reads and sets parameters and triggers actions. Every control and button has a stable `data-testid`, so tests keep working when the UI is replaced.
4. Every component state in the Figma is implemented: default, hover, active, disabled, error, plus the empty and loaded states of the stack list and the thumbnails.

**Two phases**

1. **Engine phase** (while the Figma is being made): the agent builds the app with a plain functional UI using the library's default look. It gets all automated tests and the behavior review. The aesthetics are not reviewed yet.
2. **UI pass** (when the Figma is ready): the agent maps the Figma to components and tokens, then hands over a review build. The user compares it side by side with the Figma.

**Figma handoff**

- Components with variants for every state. Variables for colors, spacing and type. Layers named after the groups Shader / Control / Mask.
- Short notes where behavior matters (drag-reorder, disabled mask controls, error messages).
- The animation speed control, and the state while animating, with the offset slider moving.
- The link, so the agent can read the file through a Figma connector. If the agent has no Figma access: frames exported as PNG and the variables as a tokens file.

---

## 8. Testing

### 8.1 Who checks what

| Agent verifies (automated) | The user judges (manual) |
|---|---|
| Code checks and build | Look of the UI, compared with the Figma |
| Shader pixels are correct | Look of the output: blend smoothness, banding, mask edges |
| Every control does what §3 says | Feel of sliders, drag, switching |
| Sources, stack, switch, mask logic | Fit with the creative workflow, using real media |
| Error handling | Smoothness on their own machine |
| Production build serves correctly, as on Netlify | |
| Every control from the Figma exists and is usable | Whether the result matches the Figma |

### 8.2 What the agent must verify

Pixel checks use a small tolerance (about ±2 to 3 out of 255), because a software GPU differs slightly from a real one.

- **Shader**, compared with a plain-code reference implementation of §4:
  - Stack selection: hard and smooth, cyclic off and on, the wrap from last to first layer in cyclic smooth mode, n = 1, 2 and 32, `num images` lower than loaded.
  - Control: contrast 1 (unchanged), 0 (flat grey), above 1; offset with clamp and with wrap; luma weights (pure red, pure green, pure blue controls).
  - Mask: white, black and mid-grey masks; min / max remap, including min greater than max; invert; influence 0, 0.5 and 1; mask reads luminance (pure red, green and blue masks give 0.2126, 0.7152 and 0.0722); the original control shown through the mask has no contrast and no offset.
  - Orientation of images and of videos, and no graphics errors after each case.
  - Transparency: a stack image with transparent pixels gives opaque output (alpha 255), flattened over black.
- **App:** control switching video and image, stack add / remove / reorder, every control changes the output and reset restores it, mask controls disabled with no mask (D11), mask load and remove, working-resolution change, snapshot is a valid PNG of the right size, errors are visible, no console errors on load.
- **Offset animation**, with a controlled clock: speed 0 keeps the offset still, a positive speed advances it linearly (after t seconds the value is the start plus speed × t, wrapped to 0..1), a negative speed runs backwards and wraps from 0 to 1, doubling the speed doubles the rate, the offset slider follows the animation, dragging the slider continues from the new position, a hidden tab pauses with no jump, reset-to-default sets offset and speed to 0. With cyclic on there is no jump in the output at the wrap.
- **Serving:** the production build loads over HTTP as a static site (the way Netlify serves it), with no missing files or console errors, and also works from a subfolder.
- **Performance:** measure and report only. Software rendering is not representative, so it never fails the build.

**Support the app must provide for testing:** a debug access in test builds only (read and set parameters, load media, read pixels, frame counter, graphics errors), a controllable clock so animation can be stepped frame by frame, deterministic generated fixtures, a demo scene (`?demo=1`, the user can drop their own media in `demo/`), and a toggleable stats overlay (fps, frame time, layers, resolution) in the review build.

### 8.3 The user's review

After the agent tests pass, the agent starts a **review build** and hands over the URL, a short summary and `tests/REPORT.md` with screenshots. The user rates each area **Keep**, **Tweak** or **Rework**:

| Area | Questions |
|---|---|
| Look | Does it match the Figma? Type, spacing, contrast, grouping, labels (from the UI pass on) |
| Output | Clean hard edges? Pleasant crossfade? Banding? Mask edges? Does cyclic mode loop nicely? Does the offset animation look right? |
| Feel | Slider speed and useful range, animation speed control, drag-reorder, source switching |
| Flow | Quick to set up a scene? Anything missing or in the way? |
| Machine | Smooth on your computer and browser (stats overlay)? |

Feedback in chat is enough. For each Tweak or Rework the agent writes the decision in `decisions.md`, updates this document, adds tasks, and adds a regression test if the feedback was about behavior.

### 8.4 Flow and rules

1. Agent builds, runs all automated checks, fixes failures.
2. Agent writes `tests/REPORT.md`: what passed, screenshots, performance numbers, known limitations.
3. Agent hands over the review build. The user reviews.
4. Agent applies feedback through this document, and the loop repeats.

- A step is **done** only when the automated checks pass **and** the user accepts the review.
- The agent never edits or removes a test to make it pass without writing why in the report.
- Any shader change also updates the reference implementation and its tests.
- A bug found by the user gets a failing test first, then the fix.
- Anything that cannot be verified without a real GPU goes under "Not verified" in the report. The agent does not claim it works.

---

## 9. Build order, future features, out of scope

**Suggested order** (each step ends with the agent test report and the user's review):
1. Shader running with hardcoded inputs, with its tests.
2. Image stack and `num images`.
3. Control source, switch, and the control controls (contrast, offset, cyclic, offset animation).
4. Mask source and mask controls.
5. FX stage, snapshot, reset-to-default.
6. UI pass from the Figma.
7. Netlify deploy.

**Future features** (not in v1, but v1 must not block them):
- **Video recording** of the live shader output as a video file. The output canvas must stay capturable at the working resolution.

**Out of scope for v1:** FX content, saving / loading projects, multi-user, mobile layout, audio.

---

## 10. Open questions (Resolved 2026-10-25)

- **Q1.** Contrast range: the shader only says 1 = unchanged. Is 0..4 a good range for the slider?
  - **Resolved:** Yes, `0..4` with default `1`. Also include the `invert color` toggle from the Figma prototype on the control input (default `0`, preserving exact `texture_stack3_web.frag` output when off) alongside all Spec §3 controls.
- **Q2.** Is one fixed working resolution for the whole stack acceptable?
  - **Resolved:** Yes, one shared working resolution (default `1280×720`, customizable `x` / `y` in the UI) for both the stack cover-fit and output canvas (D4).
- **Q3.** What should the FX stage contain later: built-in effects, or user-written GLSL?
  - **Status:** Pass-through FBO stage in v1 (D5), structured so either built-in uniforms or custom fragment shaders can slot into the FX pass later.
- **Q4.** Should the control source also accept a webcam, and should video files loop?
  - **Resolved:** Yes — loaded video files loop automatically (`loop = true`), and the `webcam` button shown in the Figma prototype is active on both Control and Mask inputs (`getUserMedia`).
- **Q5.** Netlify: who owns the account and does the deploys? Custom domain?
  - **Resolved (2026-10-25):** Deployed via Netlify CLI on the user's account (team `src.phag`). Site: **https://texturestack.netlify.app** (admin: https://app.netlify.com/projects/texturestack, project ID `be0318fa-d1a2-4de1-a609-b57fde8ada41`). Production verified: demo scene loads (25 stack layers, 1280×720 canvas), zero console errors, debug API gated off without `?debug=1` (§8.2). Custom domain: none yet.
