---
'@medkitjs/core': minor
'@medkitjs/elements': minor
---

`processVideo()` encodes an H.264 ladder (480p, 720p, 1080p by the short side, never above the source), optional AV1, a keyframe at 0 and every 2 seconds, faststart, audio removed unless `keepAudio`, all metadata stripped, `trim` and `posterAt`, a poster through the image pipeline, optional HLS packaged from the same encodes, and a manifest, with the same hash cache and orphan cleanup as images. It stops with a clear message when ffmpeg, ffprobe or a needed encoder is missing. In the manifest, `audio` is now `false` or `'mp4a.40.2'`, and the poster's `placeholder` is optional with a new `at`.
