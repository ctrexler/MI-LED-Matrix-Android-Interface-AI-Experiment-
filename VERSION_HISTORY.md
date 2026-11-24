# LED Matrix Controller Version History

## 0.5.5 — 2026-11-24
- Parallelized Live Preview packet writes across all 4 per-display BLE lanes (`lanes[0..3]`) while keeping block-by-block lockstep synchronization.
- Added parallel stored slideshow uploads with a temporary **Fast parallel upload (test mode)** toggle in Send to displays.

## 0.5.4 — 2026-11-23
- Replaced default WebView `"The page at 'file://' says:"` alert/confirm headers with native **LED Matrix Controller** dialogs.
- Enabled **Background layer** support for animated GIFs (via the new-step Layer selector and Background layer editor).

## 0.5.3 — 2026-11-21
- Background layer support per step (None, Image, or Custom Pattern/Shapes) with **Apply to all steps**, composited underneath transparent PNGs, animated GIFs, and patterns.
- Layer selector (**Foreground** vs. **Background**) when adding a new step.
- Transparent (`∅`) color option for pattern palette colors and shape backgrounds.
- **Rotate colors across steps** toggle and **Generate full cycle** button on foreground and background patterns.
- Direction support for `zigzag` stripes and horizontal sliders for pattern size/thickness/spacing and direction/rotation.
- Auto **Original size (no upscale)** fitting for images/GIFs under 16px plus horizontal and vertical position sliders.

## 0.5.2 — 2026-11-21
- Built-in GitHub Releases auto-updater (silent launch check, **Check for update** button in About, in-app APK download & installer prompt).
- Rolling `latest` GitHub Release workflow with auto-incrementing `versionCode` and version derived from `build.gradle`.

## 0.5.1 — 2026-11-21
- Display color calibration sliders (Gamma, Dark cutoff with black-point remapping, Brightness) applied during hardware RGB encoding without altering saved images.
- Enabled **Repeat on all four displays** placement for images and animated GIFs in addition to patterns.

## 0.5.0 — 2026-11-15
- Animated GIF import with bundled pure-JS GIF87a/GIF89a decoder (capped at 25 frames).
- GIF preview & frame editor popup with live animation playback, adjustable global speed, fitting/smoothing options, frame reordering, and soft-delete/restore (greyed-out deleted frames).
- Group-aware step replacement and sequence persistence (`gifGroups`) so reopening any GIF step restores all frames and shifts successive steps cleanly on edit.

## 0.4.4 — 2026-11-13
- Added All-displays vs. One-display-per-line storyboard view toggle in Editor.
- Displays tab now arranges cards to match the selected physical layout (e.g. 2×2).
- Filtered Bluetooth scan results to `MI Matrix Display` devices and removed the bottom Stored Images shortcut from Editor.

## 0.4.3 — 2026-11-13
- Added step management controls (Remove pattern, Delete entire step, Move earlier/later) to the pattern editor.
- Added drag-rearrangeable color palette (pointer capture + HTML5 drag) with quick-tap `◀` / `▶` shift buttons.
- Changed default pattern and shape size to 4 pixels.

## 0.4.2 — 2026-11-13
- Synchronized Live Preview and Library playback using interleaved round-robin block transmission, parallel RGB tile conversion, and zero-delay playback dispatch.
- Synchronized stored slideshow start dispatch (`fastWrite`) and enabled high-priority BLE connection parameters.

## 0.4.1 — 2026-11-13
- Merged update bundle into clean base assets and streamlined the GitHub Actions APK build workflow.

## 0.4.0 — 2026-11-07
- Supplied launcher artwork and LED Matrix Controller name.
- Destination selection follows arrangement for upload and stored playback.
- App-maintained per-device stored image records with tracked/partial/uncertain/unknown status and local draft editing/copying.
- Extended shapes (heart, star, circle, square, diamond, triangle, arrow, dots, diamond-band, zigzag) with up to 8 palette colors.
- Added About page, version history, and storage records in backups.

## 0.3.0
- Added Live Preview hardware streaming over BLE and per-device serial Bluetooth lanes.
- Added procedural pattern editor (solid, gradient, checkerboard, stripes, border).

## 0.2.0
- Added storyboard sequence editor with spanning, repeated, and per-panel modes.
- Added physical layout arrangement (2×2, 4 across, 4 stacked), Library save/load, and JSON backup import/export.

## 0.1.0
- Initial Android BLE matrix controller prototype with WebView UI, 4-display scan/connect, diagnostic launcher, RGB frame upload, and stored slideshow playback.

