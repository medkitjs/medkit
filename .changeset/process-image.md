---
'@medkitjs/core': minor
'@medkitjs/elements': minor
---

`processImage()` writes AVIF, WebP and JPEG at every width up to the original, a blur placeholder of at most 600 characters, the dominant colour and a manifest, and skips work it has already done. The image manifest's `placeholder` is now optional: it is absent when no blur fits, and readers fall back to `color`.
