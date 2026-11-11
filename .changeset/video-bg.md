---
'@medkitjs/elements': minor
---

`<medkit-video-bg>` plays a muted background video without ever showing a black frame: the server-rendered poster covers the video until a frame has painted during playback, then fades out. Nothing loads until the element is within 200px of the viewport, and nothing at all with reduced motion, Save-Data or 2G. It picks the smallest rendition that covers its box (AV1 when playable), pauses below 10% visible or in a hidden tab, keeps the poster when autoplay is refused, remembers a visitor's pause for the session, and has pause and sound buttons.
