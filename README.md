# TextureStack

A browser tool that runs the Texture Stack GLSL shader live. A **control map** (video, webcam, or image) picks, per pixel, which image of a **stack** is visible using its luminance. An optional **mask** (video, webcam, or image) mixes the original control image back in. The result goes through an FX stage and is drawn on a canvas.

Spec: [`Specification/texture-stack-spec-v0.7.md`](Specification/texture-stack-spec-v0.7.md) · Decisions: [`decisions.md`](decisions.md) · Test report: [`tests/REPORT.md`](tests/REPORT.md)

## Run

```bash
npm install
npm run dev        # http://localhost:5173  (+ ?demo=1 for the demo scene)
```

## Review & test

```bash
npm run build      # type-check + static production build into dist/
npm run preview    # serve the production build
npm test           # Vitest unit tests + Playwright WebGL2/E2E tests
npm run test:unit
npm run test:e2e
```

## Deploy

Static site, no server code. `netlify.toml` is included (`npm run build` → `publish = "dist"`).

## Stack

Raw WebGL2 (no framework), TypeScript, Vite, Vitest + Playwright, [`terminal.css`](https://github.com/letieu/terminal.css) styled to the Figma UI.

- `src/engine/` — WebGL2 pipeline, state, controllable clock, CPU reference shader, debug API
- `src/shaders/` — standalone GLSL (`texture_stack3_web.frag`, FX pass, fullscreen vertex)
- `src/ui/` — swappable UI (every control has a stable `data-testid`)
- `public/demo/` — demo scene assets (`?demo=1`)
