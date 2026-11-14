---
'@medkitjs/elements': minor
---

`<medkit-player popup>` (`renderPlayer(…, { popup: true })`) shows a thumbnail button with a play icon and the duration, in the box the video had without JavaScript. It opens the player in a native modal `<dialog>` named after the title, starts playback and focuses the pause button; the page behind cannot scroll. Esc, the close button or a click on the backdrop closes it, pauses, and returns focus to the thumbnail. Fires `medkit-popupopen` and `medkit-popupclose` (with `currentTime`); `open(at)` and `close()` do the same from script.
