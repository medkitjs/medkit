---
'@medkitjs/elements': minor
---

The background's expand button now opens the clip in the `<medkit-player>` popup at the background's moment, with the manifest's `player` set and its sound; when the popup closes, the background goes on from where the popup stopped, unless the visitor had paused it, and focus returns to the expand button. `renderVideoBg()` writes each clip's popup with `renderPlayer()` when `controls` has `expand`, and takes per-clip `captions` for it. The player's code loads only on expand. `medkit-expand` is now cancelable: a page that calls `preventDefault()` handles the hand-off itself.
