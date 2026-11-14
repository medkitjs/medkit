---
'@medkitjs/elements': minor
---

`<medkit-player>` chooses what to play at the first play: native HLS where the browser has it, else HLS through hls.js when opted in, else the smallest MP4 rendition that covers the player's width. hls.js is opt-in and an optional peer dependency: `import '@medkitjs/elements/hls'` with a bundler, or `configure({ hls: () => import(url) })` without one, and it loads only when such a browser plays HLS. The player itself never imports it, so a build without hls.js installed succeeds. A fatal hls.js error falls back to MP4 with a console warning.
