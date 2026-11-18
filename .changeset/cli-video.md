---
'@medkitjs/core': minor
'@medkitjs/cli': minor
---

`medkit process` encodes videos too. `medkit.config.js` takes a `video` section: defaults for `ladder`, `av1`, `hls` and `keepAudio`, and per-file options (`trim`, `posterAt` and the rest) under `files`, keyed by path relative to the source folder (`srcDir`). A `files` path that matches no video, or an image named like a video's poster (both would write the same files), is refused before anything is written, and ffmpeg is checked once, only when the folder has videos.
