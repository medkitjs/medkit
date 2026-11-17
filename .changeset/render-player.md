---
'@medkitjs/elements': minor
---

`renderPlayer({ video, poster, title }, { baseUrl, captions, popup, labels })` writes `<medkit-player>` around a native `<video controls>` that plays with no JavaScript: the manifest's `player` set when it has one, HLS first, then an MP4 no wider than 1280 px, with caption tracks (and `crossorigin` only when a track is on another origin). React `Player` and Astro `Player.astro` render the same bytes.
