---
'@medkitjs/core': minor
'@medkitjs/elements': minor
---

Every rendition now has exactly the source's aspect ratio, so an image never resizes its box when it loads: widths snap to the nearest one with a whole-pixel height (a 3:2 source gets 321, 639, 960…), and a source with an unusual ratio is cropped by the fewest pixels to one that allows it. CDN images get a fixed `aspect-ratio`, because the CDN rounds heights.
