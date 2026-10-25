# Texture Stack — Decisions & Custom CSS Log

## User Clarifications (2026-10-25)

| # | Area | Decision |
|---|---|---|
| U1 | Figma vs Spec §3 Controls | Keep all Spec §3 controls (`num images`, `smooth blend`, `cyclic`, `contrast`, `offset`, `speed`, `mask influence`, `invert mask`, `mask min`, `mask max`, per-control/group `reset`, `PNG snapshot`) styled in the Figma / `terminal.css` look, and also include the Figma `invert color` toggle on the control input (default `0`). |
| U2 | Working Resolution (§10 Q2) | Use one shared working resolution (default `1280×720`, customizable `x` / `y` inputs in the Parameters panel) for both stack cover-fit (`TEXTURE_2D_ARRAY`) and output canvas (Spec D4). |
| U3 | Webcam & Video Looping (§10 Q4) | Video files loop automatically (`video.loop = true`), and the `webcam` button shown in the Figma prototype is enabled for both Control and Mask inputs. |
| U4 | Contrast & Build Flow (§10 Q1 & §9) | Contrast range is `0..4` (default `1`). Build Steps 1–6 continuously into a complete, tested review build with `tests/REPORT.md`. |
| U5 | Playback bar per input media (review Tweak, 2026-10-25) | Bottom playback element shows one transport per input media (control left, mask right), matching the Figma "Progress Bar" frame (`22:1581`): Video = play/pause + grey track `#333333` + cyan fill `#8be9fd` + `MM:SS / MM:MM` (current `#cccccc`, total `#666666`); Webcam = red track `#ef2828` + `Live` label, play button disabled; Image/None = static grey track `#d9d9d9`, no time display, play button disabled. Logged as Spec D14. |
| U6 | Video sync button (review Tweak, 2026-10-25) | A `⟲ sync` button (enabled when any video is loaded) seeks all loaded videos to 0 and plays them; newly loaded videos explicitly start at `currentTime = 0`. Logged as Spec D15. |
| U7 | Sync button placement (review Tweak, 2026-10-25) | Moved the sync button from the bottom playback footer to the Parameters column, inside the `animation` group (label `⟲ sync videos`). Test IDs unchanged; behavior identical (D15). |
| U8 | Webcam preview & thumbnail proportions (review Rework, 2026-10-25) | Webcam thumbnail was captured before the first frame (empty preview on real hardware): now waits for `loadeddata`/`playing` before capturing. All source thumbnails (image, video, webcam, raw fixtures) are square **cover-cropped** (overflow cropped) instead of stretched, so non-square media keeps its proportions — same rule as stack layers (D4). Regression tests: webcam preview populated with real content; 4:1 image with colored edge strips verifies edges are cropped, not squeezed. |

## Custom CSS Additions Log (§7 Rule 1)

`letieu/terminal.css` v0.0.4 provides base terminal variables, typography, `.button`, `.control`, `.input`, `.progress`, `.toast`, `.tag`, and `.title`. The following custom rules are added in `src/ui/styles.css` where `terminal.css` lacks a component required by the Figma prototype and Spec §3:

1. **App 3-column studio grid (`Desktop - 1:1` / `16:9` layout):** Fixed left `Inputs` column (`260px`), flexible center `Canvas` + `Playback actions` stage, and fixed right `Parameters` column (`220px`) matching the Figma frames (`1:2`, `10:701`, `10:1053`).
2. **Prefix + Input / Slider composite control (`.ts-control-row`, `.ts-slider`):** `terminal.css` `.control` only wraps a bare text `.input`. Added the Figma split prefix box (`border-right: 1px solid var(--border-color)`) plus synchronized range slider + numeric readout and individual reset button.
3. **Source Thumbnail & Empty State Box (`.ts-source-preview`):** Square/aspect preview container (`118×118` in Figma) with empty-state dashed/bordered dropzone (`add video` / `add image` glyph + cyan label from Figma node `10:1229`) and loaded thumbnail preview.
4. **Stack Thumbnail Strip & Drag-Reorder Items (`.ts-stack-list`, `.ts-stack-item`):** Horizontal/grid scrollable thumbnail strip with active layer badge, drag-over indicator, reorder buttons, and remove button.
5. **Stats Overlay (`.ts-stats-overlay`):** Toggleable monospace HUD overlay (`fps`, `frame time`, `layers`, `resolution`) required by §8.2.
6. **Dual playback transports (`.ts-transports`, `.ts-transport`, track variants `.progress.is-live` / `.is-static`) and sync button (`.ts-sync-btn`):** Two side-by-side transport blocks (control / mask) with per-media track coloring (red `#ef2828` webcam "Live", light grey `#d9d9d9` static image/none) from the Figma "Progress Bar" frame. `terminal.css` only provides a single generic `.progress` (D14/D15).
