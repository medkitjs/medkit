---
'@medkitjs/elements': minor
---

`<medkit-video-bg>` steps down to a rendition the connection can sustain and starts playback only once enough is buffered to play through, so a slow connection waits on the poster instead of stalling on a frozen frame. `renderVideoBg()` writes each rendition's average bitrate, and takes `intro`, a CSS colour shown instead of the first poster, which is then fetched only when no video will play.
