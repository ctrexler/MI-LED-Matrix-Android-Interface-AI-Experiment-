# LED Matrix Controller Version History

## 0.9.0 — 2026-11-21
- Background layer support per step (None, Image, or Custom Pattern/Shapes) with **Apply to all steps**, composited underneath transparent PNGs, animated GIFs, and patterns.
- Transparent (`∅`) color option for pattern palette colors and shape backgrounds.
- **Rotate colors across steps** toggle and **Generate full cycle** button on foreground and background patterns.

## 0.8.0 — 2026-11-21
- Display color calibration sliders (Gamma, Dark cutoff with black-point remapping, Brightness) applied during hardware RGB encoding without altering saved images.
- Enabled **Repeat on all four displays** placement for images and animated GIFs in addition to patterns.
- Built-in GitHub Releases auto-updater (silent launch check, **Check for update** button in About, in-app APK download & installer prompt) and rolling `latest` release workflow with auto-incrementing `versionCode`.

## 0.7.0 — 2026-11-15
- Animated GIF import with bundled pure-JS GIF87a/GIF89a decoder (capped at 25 frames).
- GIF preview & frame editor popup with live animation playback, adjustable global speed, fitting/smoothing options, frame reordering, and soft-delete/restore (greyed-out deleted frames).
- Group-aware step replacement and sequence persistence (`gifGroups`) so reopening any GIF step restores all frames and shifts successive steps cleanly on edit.

## 0.6.0 — 2026-11-13
- Merged update bundle into clean base assets and streamlined build workflow.
- Synchronized Live Preview and Library playback using interleaved round-robin block transmission, parallel RGB tile conversion, and zero-delay playback dispatch.
- Synchronized stored slideshow start dispatch and enabled high-priority Bluetooth connection parameters.
- Pattern editor upgrades: step management controls (Remove pattern, Delete entire step, Move earlier/later), drag-rearrangeable color palette with `◀` / `▶` shift buttons, and default shape size of 4 pixels.
- Editor & Displays UI: All-displays vs. One-display-per-line storyboard toggle, layout-matching Displays grid, BLE scan filtering for `MI Matrix Display`, and removed bottom Stored Images shortcut.

## 0.5.0 — 2026-11-07
- Supplied launcher artwork and LED Matrix Controller name.
- Destination selection follows arrangement for upload and stored playback.
- App-maintained per-device image records with tracked/partial/uncertain/unknown status.
- Local reorder/remove/add/copy drafts, explicitly applied as per-device replacement uploads.
- Heart, star, circle, square, diamond, triangle, arrow, dots, diamond-band and zigzag patterns with up to 8 palette colors.
- About page, version history, and storage records in backups.
- Original Append packet encoding, command order, diagnostic launcher, gated slideshow starts, application ID and optional signing retained.

## 0.4.0 (0.4-live-patterns)
- Image and pattern editor, spanning/repeated/independent sources, layout changes.
- Library and drafts, backups, Live Preview.
- Per-device serial Bluetooth lanes and coordinated stored-playback starts.
- Diagnostic launcher included.

