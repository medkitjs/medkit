---
'@medkitjs/elements': minor
---

`<medkit-player>` replaces a native `<video>` or `<audio>`'s controls with one accessible bar: play/pause, a seek bar heard as "1:23 of 4:56", mute and volume (hidden on iOS, which ignores it), a captions menu, speed from 0.5× to 2×, picture-in-picture and fullscreen (the video's own on iPhone). The keyboard map (Space/K, arrows, J/L, M, C, F, Shift+</>, Home/End, 0–9) applies only while focus is inside the player. During playback the bar fades after 2.5 s, never while focus is in it, and never around `<audio>`. Every label goes through `configure({ labels })`, `registerLocale()` and the `labels` attribute.
