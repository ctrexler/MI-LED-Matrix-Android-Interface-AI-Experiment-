# Separate storage and temporary-display paths

Both use service 0000ffd0-0000-1000-8000-00805f9b34fb and characteristic 0000ffd1-0000-1000-8000-00805f9b34fb. Pixels: 16×16 row-major RGB = 768 bytes; eight blocks of 96 bytes.

## Stored slideshow — supplied index4.html

Clear: BC 00 15 15 55
Play: BC 00 12 12 55
Store begin: BC 00 11 F1 03 55
Store end: BC 00 11 F2 04 55
Frame begin: BC 0F F1 08 08 55
Frame commit: BC 0F F2 08 09 55

Each image: store begin → frame begin → eight image blocks → frame commit → store end.
Image block is 101 bytes: BC 0F [block 1–8] [96 RGB bytes] [checksum] 55.
Checksum is sum of indices 1–98 modulo 256, at index 99. End marker at 100.
Pauses: ordinary command 200 ms; block 80 ms; store end/clear 1000 ms.

## Temporary-display candidate — user's pasted direct-image example

Frame begin: BC 0F F1 08 08 55, followed by 2 ms pause.
Eight blocks, each 100 bytes: BC 0F [block 1–8] [96 RGB bytes] 55.
No checksum; byte 99 is the end marker. Pause 5 ms after each block.
No clear, store begin/end or final frame commit.

This path is implemented under the user's explicit instruction to assume it preserves stored content. That storage behavior is unverified here. The two packet formats are intentionally not mixed. No storage command is used as a preview fallback.

Android waits for local write callbacks and prefers write-without-response where supported. MTU must accommodate complete protocol packets; no guessed fragmentation. A single worker prevents preview/storage command interleaving. Pending previews are latest-wins per device. No read-back verification or synchronized four-device playback is claimed.
