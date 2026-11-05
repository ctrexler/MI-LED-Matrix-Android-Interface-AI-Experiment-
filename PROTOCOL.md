# Protocol ported from the supplied index4.html

Service UUID: 0000ffd0-0000-1000-8000-00805f9b34fb
Characteristic UUID: 0000ffd1-0000-1000-8000-00805f9b34fb

Commands (hex):

| Command | Bytes |
| --- | --- |
| Clear stored images | BC 00 15 15 55 |
| Play slideshow | BC 00 12 12 55 |
| Store begin | BC 00 11 F1 03 55 |
| Store end | BC 00 11 F2 04 55 |
| Frame begin | BC 0F F1 08 08 55 |
| Frame commit | BC 0F F2 08 09 55 |

Each 16×16 tile is 768 bytes, RGB, row-major. Eight blocks each contain 96 bytes. Packet length is 101: BC, 0F, block number 1–8, 96 pixel bytes, checksum, 55. Checksum is the unsigned sum of bytes at indices 1 through 98, modulo 256.

For each image: store begin → frame begin → eight blocks → frame commit → store end. Pause 200 ms after ordinary commands, 80 ms after image blocks, and 1000 ms after store end or clear. The Android port also waits for each GATT write callback. It requests MTU 185; Android may negotiate a different value. MTU must be at least 104 for 101-byte writes. It refuses to split protocol packets without verified framing support.

All image data and all four ready connections are validated before destructive clears. All four clears finish before any images are stored. Uploads run display-by-display, matching the supplied HTML approach. No application-layer response, hardware timing setting, or storage read-back operation was present in the supplied reference. None is invented here.
