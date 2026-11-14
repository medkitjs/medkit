---
'@medkitjs/core': minor
'@medkitjs/cli': minor
'@medkitjs/elements': minor
---

YouTube and Vimeo facades: `renderPlayer({ provider, id, title, poster })` writes a link to the video around its local thumbnail, and `<medkit-player provider video-id>` turns it into a play button. Nothing loads from the provider before the click apart from a preconnect on hover or focus; the click loads `youtube-nocookie.com` or `player.vimeo.com` with autoplay and a title, in the thumbnail's box or in the popup, and moves focus into it. `medkit thumbnail youtube:<id> vimeo:<id>` (and `processThumbnail()`) fetches each thumbnail once at build time, falling back from YouTube's `maxresdefault` to `hqdefault` with its letterbox cropped, and through oEmbed for Vimeo.
