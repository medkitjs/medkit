---
'@medkitjs/elements': minor
---

`<medkit-video-bg>` plays a playlist of `<medkit-clip>`s: Previous/Next with a "2 / 4" position, `autoadvance` (stopped by pausing), a 400 ms crossfade that never blends two clips into a darker frame (a cut with reduced motion), inert overlays on inactive clips, a polite announcement on manual changes only, the next clip loading at 75%, and a `medkit-clipchange` event. The sound button now needs `sound` in `controls`.
