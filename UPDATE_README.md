# LED Matrix Controller 0.5.0 update bundle

## Important packaging note
This is an update bundle for the CURRENT repository, not a standalone source project
and not a compiled APK. It preserves the existing source files and generates complete
replacement files during your GitHub Actions build. This avoids manually reconstructing
or truncating your working editor and Bluetooth transport from copied chat text.

The included workflow runs tools/apply_v05.py BEFORE building. That script applies
checked changes to your v0.4 files, adds the new extension/assets, and produces a
complete source-project ZIP as a separate Actions artifact. It stops if expected
baseline anchors differ. It does not use the internet or push commits.

## Upload and build
1. Export your current library from the app first and retain that backup.
2. Extract this update ZIP. Upload its CONTENTS into the EXISTING repository root,
   preserving folders. Do not delete existing source files, and do not upload an
   enclosing directory. Include .github/workflows/build.yml and the tools folder.
   A Git checkout/desktop upload is fine if your mobile browser cannot upload folders.
3. Commit on main (or master). The existing push build runs; you may also run Build APK
   manually from Actions.
4. Download the LED-Matrix-Controller-apk artifact after a successful build.
5. The separate LED-Matrix-Controller-v0.5.0-full-source artifact contains a ZIP with
   the COMPLETE updated project. You may extract it and commit the generated files
   back to the repository so the repository itself reflects the generated update.
   Re-running the updater on generated sources is designed to be idempotent.

The updated app version is 0.5.0, versionCode 5. Application ID remains
org.fourdisplay.studio. Existing optional signing secret names are unchanged. If your
old and new APKs have different signing keys, Android will not install one over the
other. Do not uninstall without exporting first; uninstalling removes local records.

## New UI
- Send to displays: layout-matching destination grid; Replace or Append to selected
  ready displays. Other displays receive no storage writes. Spanning sections retain
  their original positions rather than being resized to the selected subset.
- Start stored slideshow: select connected destinations; shared-gate starts retained.
- Stored Images: separate navigation page, one display collection at a time, plus an
  editor shortcut. Each collection is keyed by physical Bluetooth address.
- Edit collection: draft-only Earlier/Later/Remove/Add from library. Apply explicitly
  clears and rewrites that single display. Empty lists cannot be applied in this version.
- Tap an image for a large preview; Copy to another display creates that display's
  replacement draft. Draft edits must be applied or discarded; they are not autosaved.
- Patterns: choose Create pattern to open the expanded editor. Existing patterns
  also open in the expanded editor. Image editing offers Use shapes / advanced patterns. Supports span,
  repeat, or single-panel placement. Up to eight palette colors are supported. Solid
  uses only its first color; Border uses its first two. Shapes use background separately.
- About: basic operation, privacy/backup notes, limitations and documented version history.

## Storage truth and failure behavior
This is NOT device read-back. Existing contents start Unknown. Successful Replace
establishes a tracked collection. Appending to a complete tracked collection extends it;
otherwise only known additions are partially tracked. Tracking indicates successful
command completion, not independent hardware verification. Upload preparation writes an
uncertain journal before native storage operations. A per-device completion callback
commits that device's intended collection. Failure/cancel/process death can leave records
uncertain. Changed contents from other controllers cannot be detected.

Backups include storage records keyed by Bluetooth address. Importing these is optional,
uses a separate confirmation, and marks imported records uncertain; slot assignments are
not imported. Backups should be kept private.

Append uses the same original native storage command sequence, image encoder, delays,
and sequential device ordering. Only destination filtering and tracking callbacks were
added. There is no app-managed fake append or automatic whole-list rewrite for Append.

## Validation status
JavaScript syntax, Python syntax, patch generation/idempotence and mocked logic checks
were exercised locally. An Android SDK/Gradle build and physical display tests were NOT
available in this environment. The GitHub build is the actual compilation check. This
should be treated as a test release, not a hardware-validated production release.

First test one selected display with one distinctive image. Check untouched displays,
Append, tracking counts, and stored playback before testing a full four-display sequence.
Test interrupted Replace with disposable images: changes cannot be rolled back.
