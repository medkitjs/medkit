---
'@medkitjs/core': minor
'@medkitjs/elements': minor
---

`processVideo()` takes `player: { keepAudio, hls, ladder }` (also in `medkit.config.js`) and writes a second, H.264-only set for `<medkit-player>` beside a silent background, from the same decode: with sound and HLS by default. The manifest records it as an optional `player: { audio, mp4, hls }`, still `"v": 1`. A single-rung HLS package now names its init segment after the rung (`180p_init.mp4`) instead of a literal `%v_init.mp4`.
