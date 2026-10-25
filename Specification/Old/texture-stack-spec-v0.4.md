# Texture Stack — Technical Decisions

Status: v0.4 (reduced) · 2026-10-22
Replaces the full spec v0.3. The tech stack and architecture are **not decided here**: the agent decides them and records each choice in §6.

Reference files:
- `texture_stack.frag` — reference implementation of the shader logic (WebGL2 syntax)
- `texture_stack_v2.glsl` — same logic for TouchDesigner, to compare behavior
- ![[Schem.jpg]]
This schem show the architecture of the app
---

## 1. Goal

A web interface that runs the Image Stack Selector GLSL shader live. A grayscale **control map** (video or image) picks, per pixel, which image of a **stack** is visible. An optional **mask** (video or image) picks where the control map itself is shown instead. The result goes through an FX stage (empty in v1) and is drawn on a canvas. The output of the shader would be saved as a video file recording the live output of the shader. The web app will be deployed and published via netlify.

It is an artistic tool. The agent proves it works. Dani judges how it looks and feels.

## 2. Decision status

| Area                                                                                      | Status                     |     |
| ----------------------------------------------------------------------------------------- | -------------------------- | --- |
| Behavior, inputs, controls (§3)                                                           | Decided                    |     |
| Shader logic and uniforms (§4)                                                            | Decided                    |     |
| Constraints (§5)                                                                          | Decided                    |     |
| Tech stack, architecture, libraries, project structure, build, serving, test tooling (§6) | **Delegated to the agent** |     |
| Testing split and done rule (§7)                                                          | Decided                    |     |


---

## 3. Behavior

Pipeline: **control source** (switch video | image) + **stack** (n images) + **mask source** (switch video | image, optional) + **UI controls** → shader → FX stage → render canvas.

| #   | Decision                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Control and mask each have their own video/image switch. Switching does not reload the page.                                                                                                                  |
| D2  | The stack is an ordered list of images: add many, remove, reorder. Order = layer index. Maximum 32.                                                                                                           |
| D3  | `num images` defaults to all loaded images and can be lowered. The shader only uses the first n.                                                                                                              |
| D4  | One **working resolution** for the whole stack (default 1280×720, selectable). Stack images are cover-fitted to it when loaded. Control and mask are sampled in normalized UV, so they stretch to the canvas. |
| D5  | The FX stage exists as a real pass, and is pass-through in v1.                                                                                                                                                |
| D6  | Live render: updates every frame while any video plays, otherwise only when something changes.                                                                                                                |
| D7  | PNG snapshot at working resolution.                                                                                                                                                                           |
| D8  | All controls update in real time, are grouped (Shader / Control / Mask), and each has reset-to-default. Small thumbnails show the control and mask after processing.                                          |
| D9  | Errors (unsupported file, shader failure, no GPU support, too many images) are visible in the UI, never only in the console.                                                                                  |
| D10 | Aesthetic direction: terminal / TUI look (from the board references terminal.css and). This is a direction only. The final look is user's call in review.                                                     |

### Parameters

| UI name | Uniform | Type | Range | Default | Description |
|---|---|---|---|---|---|
| num images | `uNumImages` | int | 1..loaded | all | Images in use |
| smooth blend | `uSmoothBlend` | float 0/1 | 0/1 | 1 | Crossfade vs hard edges |
| input offset | `uInputOffset` | float | -1..1 | 0 | Added to the control after contrast |
| input contrast | `uInputContrast` | float | 0..1 | 0.5 | 0.5 = neutral |
| input invert | `uInputInvert` | float 0/1 | 0/1 | 0 | Invert control |
| mask enabled | `uMaskEnabled` | float 0/1 | 0/1 | 0 | Automatically 1 when a mask is loaded |
| mask range | `uMaskRange` | vec2 | 0..1 | (0, 0) | Mask values inside the range show the control map instead of the stack |

---

## 4. Shader contract

The behavior below is fixed. Whatever API the agent chooses, the output must match `texture_stack.frag`.

**Algorithm, per pixel**

1. `c` = luma of the control pixel (weights 0.2126, 0.7152, 0.0722).
2. Invert: if on, `c = 1 − c`.
3. Contrast: `c = (c − 0.5) · (2 · contrast)² + 0.5`.
4. Offset: `c = clamp(c + offset, 0, 1)`.
5. Mask: if enabled and the mask pixel's luma is inside `[min, max]`, output `(c, c, c, 1)` and stop.
6. `scaled = c · (n − 1)`.
7. **Hard:** layer = `clamp(floor(scaled + 0.5), 0, n−1)`, output that layer. **Smooth:** `a = floor(scaled)`, `b = min(a + 1, n−1)`, output `mix(layer a, layer b, fract(scaled))`.

**Rules**

- With `n = 1` the output is always layer 0.
- Hard mode needs nearest filtering on the control, smooth mode can use linear.
- Images and videos must share the same orientation (no flipped sources).
- If the chosen API cannot index a list of textures dynamically (WebGL2 cannot), the agent stores the stack as one layered texture. This is why the stack shares one working resolution (D4).

---

## 5. Constraints

- Runs fully in the browser. No media is uploaded anywhere.
- Desktop Chrome and Firefox. Safari best effort.
- Target 30 fps or more at 1280×720 with 16 layers and two playing videos on a mid-range laptop.
- 32 layers at 1280×720 must allocate with no errors (about 118 MB). Memory grows with the working resolution.
- Shader code lives in its own file, not inside code strings.

---

## 6. Delegated to the agent

The agent decides: language, graphics API, UI approach, build tool, project structure, dependencies, test tooling, how the app is served.

**Rules for deciding**

1. Decide before building, and record it in the log below: the choice, the reason, and the alternatives considered.
2. Satisfy §3 to §5. Do not change the behavior to fit a tool. If a tool forces a change, tell Dani.
3. Prefer few dependencies, mainstream and maintained tools, and a setup one person can run with three commands: install, run, review.
4. Do not lock the shader contract (§4) into a framework. The shader logic must stay portable.
5. Only ask Dani about decisions that change what he sees or does (look, behavior, supported browsers). Everything else is logged.


---

## 7. Testing

### 7.1 Who checks what

| Agent verifies (automated) | Dani judges (manual) |
|---|---|
| Code checks and build | Look of the UI |
| Shader pixels are correct | Look of the output: blend smoothness, banding, mask edges |
| Every control does what §3 says | Feel of sliders, drag, switching |
| Sources, stack, switch, mask logic | Fit with the creative workflow, using real media |
| Error handling | Smoothness on his own machine |
| Production build serves correctly | |

### 7.2 What the agent must verify

Pixel checks use a small tolerance (about ±2 to 3 out of 255), because a software GPU differs slightly from a real one.

- **Shader:** hard and smooth blend, n = 1, 2 and 32, `num images` lower than loaded, invert, contrast, offset, mask on, off and range, luma conversion (pure red and pure green controls), orientation, and no graphics errors after each case. Compared against a plain-code reference implementation of §4.
- **App:** control switching video and image, stack add / remove / reorder, every control changes the output and reset restores it, mask load and remove, working-resolution change, snapshot is a valid PNG of the right size, errors are visible, no console errors on load.
- **Serving:** the production build loads over HTTP with no missing files or console errors, and also works from a subfolder.
- **Performance:** measure and report only. Software rendering is not representative, so it never fails the build.

**Support the app must provide for testing:** a debug access in test builds only (read and set parameters, load media, read pixels, frame counter, graphics errors), deterministic generated fixtures, a demo scene (`?demo=1`, Dani can drop his own media in `demo/`), and a toggleable stats overlay (fps, frame time, layers, resolution) in the review build.

### 7.3 User's review

After the agent tests pass, the agent starts a **review build** and hands over the URL, a short summary and `tests/REPORT.md` with screenshots. Dani rates each area **Keep**, **Tweak** or **Rework**:

| Area | Questions |
|---|---|
| Look | Does it have the terminal feel you want? Type, spacing, contrast, grouping, labels |
| Output | Clean hard edges? Pleasant crossfade? Banding? Mask edges? |
| Feel | Slider speed and useful range, drag-reorder, source switching |
| Flow | Quick to set up a scene? Anything missing or in the way? |
| Machine | Smooth on your computer and browser (stats overlay)? |

Feedback in chat is enough. For each Tweak or Rework the agent writes the decision in `decisions.md`, updates this document, adds tasks, and adds a regression test if the feedback was about behavior.

### 7.4 Flow and rules

1. Agent builds, runs all automated checks, fixes failures.
2. Agent writes `tests/REPORT.md`: what passed, screenshots, performance numbers, known limitations.
3. Agent hands over the review build. Dani reviews.
4. Agent applies feedback through this document, and the loop repeats.

- A step is **done** only when the automated checks pass **and** Dani accepts the review.
- The agent never edits or removes a test to make it pass without writing why in the report.
- Any shader change also updates the reference implementation and its tests.
- A bug found by Dani gets a failing test first, then the fix.
- Anything that cannot be verified without a real GPU goes under "Not verified" in the report. The agent does not claim it works.

---

## 8. Build order and out of scope

**Suggested order** (each step ends with the agent test report and Dani's review):
1. Shader running with hardcoded inputs, with its tests.
2. Image stack and `num images`.
3. Control source, switch and processing controls.
4. Mask source and range.
5. FX stage, snapshot, reset-to-default.

**Out of scope for v1:** FX content, video export, saving / loading projects, multi-user, mobile layout, audio.
