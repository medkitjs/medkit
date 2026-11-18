---
'@medkitjs/core': minor
'@medkitjs/elements': minor
---

`processVideo()` encodes an H.264 ladder (480p, 720p, 1080p by the short side, never above the source), optional AV1, a keyframe at 0 and every 2 seconds, faststart, audio removed unless `keepAudio`, all metadata stripped, `trim` and `posterAt`, a poster through the image pipeline, optional HLS packaged from the same encodes, and a manifest, with the same hash cache and orphan cleanup as images. It stops with a clear message when ffmpeg, ffprobe or a needed encoder is missing. In the manifest, `audio` is `false` or `'mp4a.40.2'`, and `poster` is the poster's full image manifest, with `at` when it was not taken at 0 s, so one video manifest holds everything the renderers need; no separate poster manifest is written.
