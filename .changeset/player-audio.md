---
'@medkitjs/elements': minor
---

`renderPlayer(…, { audio: true })` (and the React and Astro `Player`) plays a set's sound as `<audio>` from its smallest rendition, in a box exactly the bar's 52 px height, so upgrading moves nothing. The audio bar is one row and no longer wraps; a hand-written `<audio>` needs the same reserved height.
