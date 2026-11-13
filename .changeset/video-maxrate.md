---
'@medkitjs/core': minor
---

`processVideo()` caps each rung's bitrate with `-maxrate` (480p 800, 720p 1600, 1080p 3000 kbps, `-bufsize` twice that), so the 720p rendition fits Good 3G. `maxrate` in the options and in `medkit.config.js` maps ladder heights to kbps or is `false` for plain CRF; a rung with no entry is interpolated from its neighbours. Existing videos re-encode once.
