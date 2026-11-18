---
'@medkitjs/core': minor
'@medkitjs/cli': minor
---

`srcDir` in `medkit.config.js`, default `src/media`, names the source media folder. `medkit process` with no folder argument processes it, and `video.files` keys are relative to it for the CLI and the Vite plugin alike, so one config serves both.
